import React, { useEffect } from 'react';
import { Container, Card, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

const Logout = () => {
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <Container className="py-4 d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card className="text-center">
        <Card.Body>
          <Card.Title>กำลังออกจากระบบ</Card.Title>
          <Spinner animation="border" variant="primary" />
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Logout;
