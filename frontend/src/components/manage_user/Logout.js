import React, { useEffect } from 'react';
import { Container, Card, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../../App';

const Logout = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const performLogout = async () => {
      try {
        // Log the logout action to the backend
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        await apiCall('/log', {
          method: 'POST',
          body: JSON.stringify({
            action: 'LOGOUT',
            targetId: user.userid || null,
            targetType: 'USER',
            comment: `User ${user.userid || 'unknown'} logged out`,
          }),
        });
      } catch (err) {
        console.error('Error logging logout:', err.message);
      } finally {
        // Clear authentication data
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Redirect to login
        navigate('/login', { replace: true });
      }
    };

    performLogout();
  }, [navigate]);

  return (
    <Container className="py-4 d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card className="text-center">
        <Card.Body>
          <Card.Title>Logging Out</Card.Title>
          <Spinner animation="border" variant="primary" />
          <p className="mt-3">Please wait while we log you out...</p>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Logout;