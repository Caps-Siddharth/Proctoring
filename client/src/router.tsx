import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import UserEntryForm from "./pages/candidateflow/UserEntryForm";
import HeadCalibrationPage from "./pages/candidateflow/HeadCalibration";
import TestInterface from "./pages/candidateflow/testInterface";
import TestTerminated from "./pages/candidateflow/TestTerminated";
import AdminForm from "./pages/AdminForm";
import TestCompletePage from "./pages/TestCompletePage";


const Router = () => (
    <BrowserRouter>
        <Routes>
            <Route path="/" element={<Navigate to="/admin" />} />
            <Route path="/admin" element={<AdminForm/>}/>
            <Route path="/test/:token" element={<UserEntryForm />}/>
            <Route path="/test/:token/calibration" element={<HeadCalibrationPage />}/>
            <Route path="/test/:token/interview" element={<TestInterface />}/>
            <Route path="test-terminated" element={<TestTerminated/>}/>
            <Route path="/test-complete" element={<TestCompletePage/>}/>
            {/* <Route path="/" element={<AdminForm/>}/> */}
        </Routes>
    </BrowserRouter>
)

export default Router;