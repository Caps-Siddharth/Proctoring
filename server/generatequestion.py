
import os
import json
import openai
from dotenv import load_dotenv
import re
import logging
from typing import Tuple, Optional, Dict, List
from datetime import datetime

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Set OpenAI API configuration
openai.api_key = os.getenv("OPENAI_API_KEY")

# ============= IMPROVED SYSTEM PROMPT =============
def build_system_prompt(config: dict) -> dict:
    return {
        "role": "system",
        "content": f'''
        You are an AI interviewer conducting a structured technical interview at CapsiTech.
        
        CRITICAL INSTRUCTIONS:
        1. You must ask EXACTLY {config.get("num_questions")} technical questions - no more, no less.
        2. Keep track of question numbers explicitly (Question 1, Question 2, etc.)
        3. DO NOT count greetings, introductions, or transitions as questions.
        4. Only statements that require a technical answer count as questions.
        
        Interview Configuration:
        - Candidate's experience level: {config.get("experience_level")}
        - Total questions to ask: {config.get("num_questions")}
        - Difficulty level: {config.get("difficulty")}
        - Role: {config.get("role_subject")}
        
        Interview Flow:
        1. First message: Brief greeting and ask Question 1
        2. After each answer: Provide brief feedback and ask the next question
        3. Adjust difficulty based on answer quality:
           - Good answer → Increase difficulty
           - Poor answer → Maintain or decrease difficulty
        4. After the final answer: Provide summary ONLY, no more questions
        
        Question Format:
        Internally track questions as "Question X:" but DO NOT include this prefix in your response to the candidate.
        Just ask the question directly.
        Example: "Question 1: Can you explain the difference between..."
        
        Rating Scale (internal use):
        0-1: No understanding
        2-3: Basic understanding with gaps
        4: Good understanding
        5: Excellent with examples
        '''
    }

# ============= ENHANCED SESSION MANAGEMENT =============
interview_sessions = {}  # Store complete interview state

def initialize_interview_session(token: str, config: dict):
    """Initialize a new interview session with proper tracking"""
    system_prompt = build_system_prompt(config)
    
    interview_sessions[token] = {
        "config": config,
        "system_prompt": system_prompt,
        "chat_history": [system_prompt],
        "actual_questions_asked": 0,  # Track only real questions
        "actual_questions": [],       # Store the actual questions
        "answers": [],                 # Store candidate answers
        "ratings": [],                 # Store ratings for each answer
        "is_complete": False,
        "current_state": "greeting",  # greeting -> questioning -> complete
        "started_at": datetime.now().isoformat()
    }
    
    logger.info(f"Initialized interview session for token: {token}")
    return interview_sessions[token]

def get_interview_session(token: str) -> Optional[Dict]:
    """Get the current interview session"""
    return interview_sessions.get(token)

# ============= CORE INTERVIEW FUNCTIONS =============

def start_structured_interview(token: str, config: dict) -> str:
    """Start the interview with greeting and first question."""
    session = initialize_interview_session(token, config)
    
    # Create initial prompt for greeting + first question
    initial_prompt = f"""
    The candidate's name is {config.get('candidate_name')} and they are applying for a {config.get('role_subject')} position.
    
    Please:
    1. Give a brief welcoming greeting (1-2 sentences)
    2. Immediately ask Question 1 - a {config.get('difficulty')} level technical question about {config.get('role_subject')}
    Remember: do not number the question in the final message to the candidate.
    """
    
    messages = [session["system_prompt"], {"role": "user", "content": initial_prompt}]
    
    response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=0.7,
        max_tokens=200
    )
    ai_response = response.choices[0].message.content.strip()
    
    # Try to extract the actual question for logging
    question_match = re.search(r'Question\s*1:(.*?)(?:\n|$)', ai_response, re.IGNORECASE | re.DOTALL)
    if question_match:
        actual_question = question_match.group(1).strip()
    else:
        actual_question = ai_response  # Save full text if format doesn't match
    
    print(f"AI Response: {actual_question}")
    # Always set count to 1 for the first question
    session["actual_questions"].append(actual_question)
    session["actual_questions_asked"] = 1
    session["current_state"] = "questioning"
    
    # Save chat history
    session["chat_history"].append({"role": "user", "content": initial_prompt})
    session["chat_history"].append({"role": "assistant", "content": ai_response})
    
    return ai_response


def process_answer_and_get_next(token: str, answer: str) -> Dict:
    session = get_interview_session(token)
    if not session:
        return {"error": "Session not found"}
    if session["is_complete"]:
        return {"error": "Interview already complete"}

    config = session["config"]
    max_questions = int(config.get("num_questions", 5))
    current_q_num = session["actual_questions_asked"]

    # Store the answer
    session["answers"].append(answer)

    # If we've already reached the limit, end the interview
    if current_q_num >= max_questions:
        return generate_final_summary(token, answer)

    # Now we know we can ask the next question
    next_q_num = current_q_num + 1
    session["actual_questions_asked"] = next_q_num
    print(session["actual_questions"])
    prompt = f"""
    The candidate just answered Question {current_q_num}.
    Their answer was: "{answer}"

    Please:
    1. Directly ask the next question (internally Question {next_q_num})
    2. Adjust difficulty based on their answer quality
    3. Do NOT provide feedback
    Topic: {config.get('role_subject')}
    Questions remaining: {max_questions - current_q_num}
    """
    print(answer)

    messages = session["chat_history"].copy()
    messages.append({"role": "user", "content": answer})
    messages.append({"role": "system", "content": prompt})
    print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    print(f"Processing answer for question {current_q_num}: {answer}")

    response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=0.7,
        max_tokens=200
    )
    ai_response = response.choices[0].message.content.strip()

    
    # Log the question
    question_match = re.search(rf'Question {next_q_num}:(.*?)(?:\n|$)', ai_response, re.IGNORECASE | re.DOTALL)
    if question_match:
        actual_question = question_match.group(1).strip()
    else:
        actual_question = ai_response
    session["actual_questions"].append(actual_question)

    # Save to history
    session["chat_history"].append({"role": "assistant", "content": ai_response})

    return {
        "response_text": ai_response,
        "question_number": next_q_num,
        "is_complete": False,
        "questions_remaining": max_questions - next_q_num
    }



def generate_final_summary(token: str, final_answer: str) -> Dict:
    """Generate the final interview summary"""
    session = get_interview_session(token)
    if not session:
        return {"error": "Session not found"}
    
    # Rate all answers
    prompt = f"""
The interview is complete. The candidate answered all {session['actual_questions_asked']} questions.

Their final answer was: "{final_answer}".

Please respond **only** in valid JSON format with the following keys:

- overall_feedback: (string) A brief thank you message and overall performance summary in 2–3 sentences.
- strengths: (array of strings) 2–4 bullet points of the candidate's key strengths.
- areas_for_improvement: (array of strings) 2–4 bullet points on what the candidate should work on.
- average_rating: (number) The overall rating out of 5, averaged from all answers.

Example:
{{
  "overall_feedback": "Thank you for completing the interview... Overall performance was strong...",
  "strengths": ["Good communication", "Strong problem-solving skills"],
  "areas_for_improvement": ["More detail in explaining algorithms"],
  "average_rating": 4.2
}}

Important:
- Do not include any extra commentary outside the JSON.
- Ensure the JSON is valid and properly formatted.
"""
    
    messages = session["chat_history"].copy()
    messages.append({"role": "user", "content": final_answer})
    messages.append({"role": "system", "content": prompt})
    
    response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=0.7,
        max_tokens=300
    )
    
    summary = response.choices[0].message.content.strip()

    try:
        summary_data = json.loads(summary)
    except json.JSONDecodeError:
        logger.warning("Failed to parse structured summary JSON, saving raw text instead.")
        summary_data = {
            "overall_feedback": summary,
            "strengths": [],
            "areas_for_improvement": [],
            "average_rating": None
        }
    
    # Mark session as complete
    session["is_complete"] = True
    session["current_state"] = "complete"
    session["final_summary"] = summary_data
    session["completed_at"] = datetime.now().isoformat()
    
    # Save to file
    save_interview_log(token, session)
    
    return {
        "response_text": "Thank you for completing the interview. Your responses have been recorded",
        "question_number": session["actual_questions_asked"],
        "is_complete": True,
        "internal_summary": summary
    }

def save_interview_log(token: str, session: Dict):
    """Save the complete interview log"""
    config = session["config"]
    safe_name = config.get("candidate_name", "unknown").replace(" ", "_").lower()
    
    os.makedirs(f"interview_logs/{safe_name}", exist_ok=True)
    log_path = f"interview_logs/{safe_name}/interview_{token}.json"
    
    log_data = {
    "metadata": {
        "token": token,
        "started_at": session.get("started_at"),
        "completed_at": session.get("completed_at"),
        "duration_minutes": (
            datetime.fromisoformat(session.get("completed_at"))
            - datetime.fromisoformat(session.get("started_at"))
        ).seconds // 60 if session.get("completed_at") else None
    },
    "candidate": {
        "name": config.get("candidate_name"),
        "email": config.get("email"),
        "role": config.get("role_subject"),
        "experience_level": config.get("experience_level")
    },
    "config": {
        "num_questions": config.get("num_questions"),
        "difficulty": config.get("difficulty"),
        "duration": config.get("duration")
    },
    "interview": [
        {
            "question_number": i + 1,
            "question": session["actual_questions"][i],
            "answer": session["answers"][i] if i < len(session["answers"]) else None,
            "rating": session["ratings"][i] if i < len(session["ratings"]) else None
        }
        for i in range(session["actual_questions_asked"])
    ],
    "summary": session.get("final_summary", {
        "overall_feedback": "",
        "strengths": [],
        "areas_for_improvement": [],
        "average_rating": None
    })
}
    
    with open(log_path, "w") as f:
        json.dump(log_data, f, indent=2)
    
    logger.info(f"Interview log saved to {log_path}")

# ============= HELPER FUNCTIONS =============

def get_interview_progress(token: str) -> Dict:
    """Get current interview progress"""
    session = get_interview_session(token)
    if not session:
        return {"error": "Session not found"}
    
    config = session["config"]
    max_questions = int(config.get("num_questions", 5))
    
    return {
        "current_question": session["actual_questions_asked"],
        "total_questions": max_questions,
        "questions_remaining": max_questions - session["actual_questions_asked"],
        "is_complete": session["is_complete"],
        "state": session["current_state"]
    }

def reset_interview(token: str):
    """Reset an interview session"""
    if token in interview_sessions:
        del interview_sessions[token]
        logger.info(f"Interview session reset for token: {token}")

# ============= TEXT TO SPEECH (Keep existing) =============
def text_to_speech(text: str) -> Optional[bytes]:
    """Convert text to speech using OpenAI TTS."""
    try:
        response = openai.audio.speech.create(
            model="tts-1",
            voice="alloy",
            input=text
        )
        return response.content
    except Exception as e:
        logger.error(f"TTS error: {e}")
        return None