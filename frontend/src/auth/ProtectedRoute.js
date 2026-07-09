import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Container, Alert } from 'react-bootstrap';
import { isAuthenticated, getCurrentUser } from '../api/client';

// <ProtectedRoute roles={['ADMIN', 'PLANNER']}>...</ProtectedRoute>
// ไม่ส่ง roles = ขอแค่ login แล้ว
const ProtectedRoute = ({ children, roles }) => {
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && roles.length > 0) {
    const user = getCurrentUser();
    if (!roles.includes(user.role)) {
      return (
        <Container className="mt-5">
          <Alert variant="danger" className="text-center">
            คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (ต้องเป็น {roles.join(' หรือ ')})
          </Alert>
        </Container>
      );
    }
  }

  return children;
};

export default ProtectedRoute;
