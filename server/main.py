from flask import Flask, request, send_from_directory, jsonify, send_file, session, abort
from flask_cors import CORS
from generatequestion import (
    start_structured_interview, 
    process_answer_and_get_next,
    get_interview_progress,
    get_interview_session,
    reset_interview,
    text_to_speech
)
import os
import logging
import uuid
import json
import tempfile
from datetime import datetime
from flask_mail import Mail, Message
import openai

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, '..', 'client', 'dist')
print("DIST_DIR ->", DIST_DIR)
print("Exists?   ->", os.path.isdir(DIST_DIR))
print("index.html exists? ->", os.path.exists(os.path.join(DIST_DIR, "index.html")))

app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv('SECRET_KEY', 'your-secret-key-here')
CORS(app, supports_credentials=True, origins=['http://localhost:5173'])
app.config.from_object('config')  
mail = Mail(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

test_data_storage = {}
session_data = {
    'states': {},
    'violations': {},
}

# ─── HELPERS ─────────────────────────────────────


def send_test_email(recipient_email: str, token: str, candidate_name: str = "Candidate"):
    # The link your candidate should open — you’re serving the SPA from Flask,
    # so just point at /test/<token> on the same origin.
    base_url = os.getenv("PUBLIC_BASE_URL")
    link = f"{base_url}/test/{token}"

    subject = "Your Proctored Test Link"
    html = f"""
    <p>Hi {candidate_name},</p>
    <p>Your proctored test is ready. Click the link below to begin:</p>
    <p><a href="{link}">{link}</a></p>
    <p>This link is unique to you. Please use a desktop browser with camera access.</p>
    <p>Good luck!</p>
    """

    msg = Message(subject=subject, recipients=[recipient_email], html=html)
    mail.send(msg)

def load_test_config(token):
    if token in test_data_storage:
        return test_data_storage[token]
    path = f"uploads/test_{token}.json"
    if os.path.exists(path):
        with open(path) as f:
            config = json.load(f)
            test_data_storage[token] = config
            return config
    return None

def get_or_create_session_state(token):
    if token not in session_data['states']:
        session_data['states'][token] = {
            'current_stage': 1,
            'stages': {1: 'incomplete', 2: 'incomplete', 3: 'incomplete'},
            'terminated': False,
            'completed': False
        }
    return session_data['states'][token]

# ─── ADMIN ───────────────────────────────────────
@app.route('/admin/create-test', methods=['POST'])
def create_test():
    data = request.json
    email = data.get("email")

    token = str(uuid.uuid4())

    try:
        send_test_email(email, token, data.get("name", "Candidate"))
    except Exception as e:
        app.logger.exception(f"Failed to send email: {e}")
        return jsonify({"token": token, "email_sent": False, "error": str(e)}), 201

    config = {
        "token": token,
        "candidate_name": data.get("candidate_name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "experience_level": data.get("experience_level"),
        "role_subject": data.get("role_subject"),
        "difficulty": data.get("difficulty"),
        "duration": int(data.get("duration", 60)),
        "num_questions": int(data.get("numQuestions", 5)),
        "created_at": datetime.now().isoformat(),
        "status": "pending"
    }

    os.makedirs("uploads", exist_ok=True)
    with open(f"uploads/test_{token}.json", "w") as f:
        json.dump(config, f, indent=2)

    test_data_storage[token] = config
    get_or_create_session_state(token)

    return jsonify({"success": True, "token": token, "test_config": config, "email_sent": True})

# ─── INTERVIEW ROUTES (UPDATED) ─────────────────────────────

@app.route('/api/test/<token>/start-interview', methods=['POST'])
def start_interview(token):
    """Start the interview with greeting and first question"""
    config = load_test_config(token)
    if not config:
        return jsonify({'error': 'Invalid token'}), 404

    state = get_or_create_session_state(token)
    if state['terminated']:
        return jsonify({'error': 'Test terminated'}), 403

    # Start the interview and get greeting + first question
    first_response = start_structured_interview(token, config)
    print(f"First response: {first_response}")
    # Generate audio if needed
    audio_content = text_to_speech(first_response)
    audio_url = None
    
    if audio_content:
        # Save audio to temp file
        audio_filename = f"audio_{token}_q1.mp3"
        audio_path = os.path.join(tempfile.gettempdir(), audio_filename)
        with open(audio_path, 'wb') as f:
            f.write(audio_content)
        audio_url = f"/audio/{audio_filename}"
    
    return jsonify({
        'response_text': first_response,
        'audio_url': audio_url,
        'question_number': 1,
        'is_complete': False,
        'questions_remaining': config.get('num_questions', 5) - 1
    })

@app.route('/api/test/<token>/submit-text', methods=['POST'])
def submit_text_answer(token):
    """Submit answer and get next question or summary"""
    interview_session = get_interview_session(token)
    if not interview_session:
        return jsonify({"error": "Interview not started"}), 404

    data = request.json
    answer = data.get('text', '').strip()
    app.logger.info(f"[SUBMIT-TEXT] token={token}, answer={answer!r}")

    if not answer:
        return jsonify({'error': 'No answer provided'}), 400

    # Process the answer and get next question or summary
    result = process_answer_and_get_next(token, answer)
    
    if "error" in result:
        return jsonify(result), 400
    
    # Generate audio for response
    audio_url = None
    if result.get("response_text"):
        audio_content = text_to_speech(result["response_text"])
        if audio_content:
            q_num = result.get("question_number", 0)
            audio_filename = f"audio_{token}_q{q_num}.mp3"
            audio_path = os.path.join(tempfile.gettempdir(), audio_filename)
            with open(audio_path, 'wb') as f:
                f.write(audio_content)
            audio_url = f"/audio/{audio_filename}"
    
    return jsonify({
        "response_text": result.get("response_text", ""),
        "audio_url": audio_url,
        "question_number": result.get("question_number", 0),
        "is_complete": result.get("is_complete", False),
        "questions_remaining": result.get("questions_remaining", 0)
    })

@app.route('/api/test/<token>/submit-audio', methods=['POST'])
def submit_audio_transcribe_only(token):
    if 'file' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['file']

    try:
        from tempfile import NamedTemporaryFile
        import openai, os

        with NamedTemporaryFile(delete=False, suffix='.webm') as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name

        # Whisper transcription only
        with open(tmp_path, "rb") as f:
            tr = openai.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                # language="en", # optional, set if you want to force language
            )
        text = tr.text.strip() if hasattr(tr, "text") else ""

        # cleanup
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

        return jsonify({ "transcription": text })

    except Exception as e:
        return jsonify({'error': f'Failed to transcribe: {e}'}), 500


@app.route('/api/test/<token>/progress', methods=['GET'])
def get_progress(token):
    """Get current interview progress"""
    progress = get_interview_progress(token)
    if "error" in progress:
        return jsonify(progress), 404
    return jsonify(progress)

@app.route('/api/test/<token>/reset', methods=['POST'])
def reset_interview_endpoint(token):
    """Reset the interview (for testing)"""
    reset_interview(token)
    return jsonify({"success": True, "message": "Interview reset"})

# ─── KEEP EXISTING ROUTES ─────────────────────────────

@app.route('/api/test/<token>/config', methods=['GET'])
def get_test_config(token):
    config = load_test_config(token)
    if not config:
        return jsonify({"error": "Test config not found"}), 404
    return jsonify(config)

@app.route('/api/test/<token>/validate/<int:stage>', methods=['GET'])
def validate_stage_access(token, stage):
    config = load_test_config(token)
    if not config:
        return jsonify({'allowed': False, 'message': 'Invalid token'}), 404

    state = get_or_create_session_state(token)

    if state['terminated']:
        return jsonify({'allowed': False, 'redirect': 'terminated'})
    if state['completed']:
        return jsonify({'allowed': False, 'redirect': 'feedback'})

    if stage < state['current_stage']:
        return jsonify({'allowed': False, 'redirect': state['current_stage']})
    elif stage > state['current_stage']:
        return jsonify({'allowed': False, 'redirect': state['current_stage']})

    return jsonify({'allowed': True, 'token_state': state, 'session_data': config})

@app.route('/api/test/<token>/update-stage', methods=['POST'])
def update_stage(token):
    data = request.json
    stage = data.get('stage')
    status = data.get('status')
    state = get_or_create_session_state(token)

    if stage in [1, 2, 3]:
        state['stages'][stage] = status
        if status == 'complete':
            if stage < 3:
                state['current_stage'] = stage + 1
            else:
                state['completed'] = True

    return jsonify({'success': True, 'token_state': state})

##################################################################################

@app.route('/api/test/<token>/snapshot', methods=['POST'])
def upload_snapshot(token):
    try:
        if 'snapshot' not in request.files:
            return jsonify({'error': 'No snapshot provided'}), 400

        file = request.files['snapshot']
        config = load_test_config(token)
        if not config:
            return jsonify({"error": "Invalid token"}), 404

        candidate_name = config.get('candidate_name', 'unknown')
        safe_name = "".join(c for c in candidate_name if c.isalnum() or c in (' ', '-', '_')).rstrip().replace(' ', '_').lower()
        candidate_dir = os.path.join('interview_logs', safe_name)
        os.makedirs(candidate_dir, exist_ok=True)

        filename = f"cheating_snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        filepath = os.path.join(candidate_dir, filename)
        file.save(filepath)

        return jsonify({'success': True, 'filename': filename})
    except Exception as e:
        logger.error(f"Snapshot upload failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/test/<token>/violations', methods=['POST'])
def record_violation(token):
    data = request.json
    violation = {
        'type': data.get('type'),
        'timestamp': data.get('timestamp', datetime.now().isoformat()),
        'details': data.get('details', '')
    }

    if token not in session_data['violations']:
        session_data['violations'][token] = []
    session_data['violations'][token].append(violation)

    count = len(session_data['violations'][token])
    if count >= 10:
        get_or_create_session_state(token)['terminated'] = True

    return jsonify({'success': True, 'violation_count': count, 'max_reached': count >= 10})

@app.route('/api/test/<token>/terminate', methods=['POST'])
def terminate_test(token):
    reason = request.json.get("reason", "No reason provided")
    state = get_or_create_session_state(token)
    state["terminated"] = True
    state["termination_reason"] = reason
    state["terminated_at"] = datetime.now().isoformat()
    return jsonify({"success": True, "message": f"Test terminated: {reason}"})

@app.route('/api/test/<token>/status', methods=['GET'])
def get_test_status(token):
    config = load_test_config(token)
    if not config:
        return jsonify({'error': 'Invalid token'}), 404
    state = get_or_create_session_state(token)
    
    # Get interview progress
    interview_progress = get_interview_progress(token)

    return jsonify({
        'token': token,
        'candidate_info': config,
        'state': state,
        'violations': len(session_data.get('violations', {}).get(token, [])),
        'interview_progress': interview_progress
    })

@app.route('/audio/<filename>')
def serve_audio_file(filename):
    if '..' in filename or '/' in filename:
        abort(403)
    path = os.path.join(tempfile.gettempdir(), filename)
    if not os.path.exists(path):
        abort(404)
    return send_file(path, mimetype='audio/mpeg')

@app.route("/api/health")
def health():
    return jsonify({"ok": True})

# ---------- Static files & SPA fallback ----------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    # Prevent React from swallowing API routes
    if path.startswith("api/"):
        return "Not Found", 404

    # If the requested path is a real file in dist (e.g., assets/..., favicon, etc.), serve it
    candidate = os.path.join(DIST_DIR, path)
    if path and os.path.exists(candidate) and os.path.isfile(candidate):
        return send_from_directory(DIST_DIR, path)

    # Otherwise, serve index.html (React Router handles /admin, /test/:id, etc.)
    return send_from_directory(DIST_DIR, "index.html") 

if __name__ == '__main__':
    os.makedirs("uploads", exist_ok=True)
    app.run(host='0.0.0.0', port=8000, debug=True)