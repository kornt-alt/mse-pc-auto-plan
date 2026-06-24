import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Container, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { AlertCircle, User, Eye, EyeOff } from 'lucide-react';
import { apiCall } from '../../App';

const Login = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [userid, setUserid] = useState('');
  
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get the path user was trying to access, default to storage
  const from = location.state?.from?.pathname || '/about';

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let data;

      if (userid) {
        // RFID login
        data = await apiCall('/login_rfid', {
          method: 'POST',
          body: JSON.stringify({ userid }),
        });
      } else if (formData.username && formData.password) {
        // Username/password login
        data = await apiCall('/login', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      } else {
        setError('Please fill either RFID or Username and Password');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      if (onLogin) onLogin();

      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="min-h-screen d-flex align-items-center justify-content-center p-4">
      <Card className="w-100" style={{ maxWidth: '400px' }}>
        <Card.Body>
          <div className="text-center mb-4">
            <User className="mx-auto h-12 w-12 text-primary" />
            <h2 className="text-2xl font-bold">Login</h2>
            <p className="text-muted">Please Fill Username/Password or USE CardID (RFID)</p>
          </div>

          {error && (
            <Alert variant="danger" className="d-flex align-items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </Alert>
          )}

          <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>RFID (Card ID)</Form.Label>
            <Form.Control
              type="text"
              value={userid}
              onChange={(e) => setUserid(e.target.value)}
              placeholder="Scan Card or Enter ID"
            />
          </Form.Group>

          <hr />

          <Form.Group className="mb-3">
            <Form.Label>Username</Form.Label>
            <Form.Control
              type="text"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
              placeholder="Enter your username"
              autoComplete="username"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Password</Form.Label>
            <div className="position-relative">
              <Form.Control
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <Button
                variant="outline-secondary"
                size="sm"
                className="position-absolute top-50 end-0 translate-middle-y me-2"
                style={{ border: 'none', background: 'none' }}
                onClick={() => setShowPassword(!showPassword)}
                type="button"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </Button>
            </div>
          </Form.Group>

          <Button
            type="submit"
            variant="primary"
            className="w-100"
            disabled={loading}
          >
            {loading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Logging in...
              </>
            ) : (
              'Login'
            )}
          </Button>
        </Form>

          <div className="text-center mt-3">
            <Button
              variant="link"
              onClick={() => navigate('/register')}
            >
              Don't have an account? Register
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Login;