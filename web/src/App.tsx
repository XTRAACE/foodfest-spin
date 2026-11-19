import { Navigate, Route, Routes } from 'react-router-dom';
import AdminHome from './pages/admin/AdminHome';
import Login from './pages/Login';
import Register from './pages/Register';
import Spin from './pages/Spin';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Register />} />
      <Route path="/spin" element={<Spin />} />
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin" element={<AdminHome />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
