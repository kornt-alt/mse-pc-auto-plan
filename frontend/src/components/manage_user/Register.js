import React, { useState} from 'react';
import { Container, Card, Form, Button, Alert } from 'react-bootstrap';
import { AlertCircle, User, Eye, EyeOff } from 'lucide-react';
import { apiCall } from '../../App';
import { useNavigate } from 'react-router-dom';

const Register = ({ onSuccess }) => {
  const [formData, setFormData] = useState({
    userid: '',
    username: '',
    password: '',
    confirmPassword: '',
    name: '',
    role: 'Common',
    division: 'M/P 1'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();

  const validateForm = () => {
    // Check required fields
    if (!formData.userid || !formData.username || !formData.password || !formData.name) {
      setError('Please fill all required fields');
      return false;
    }

    // Check password length
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return false;
    }

    // Check password confirmation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    // Check username length
    if (formData.username.length < 3) {
      setError('Username must be at least 3 characters long');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!validateForm()) {
      setLoading(false);
      return;
    }

    try {
      const registrationData = {
        userid: formData.userid.trim(),
        username: formData.username.trim(),
        password: formData.password,
        name: formData.name.trim(),
        role: formData.role,
        division: formData.division
      };

      await apiCall('/register', {
        method: 'POST',
        body: JSON.stringify(registrationData),
      });
      
      alert('Registration successful! Please login to continue');
      navigate('/login');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="min-h-screen d-flex align-items-center justify-content-center p-4">
      <Card className="w-100" style={{ maxWidth: '450px' }}>
        <Card.Body>
          <div className="text-center mb-4">
            <User className="mx-auto h-12 w-12 text-primary" />
            <h2 className="text-2xl font-bold">Register</h2>
          </div>

          {error && (
            <Alert variant="danger" className="d-flex align-items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </Alert>
          )}

          <Form onSubmit={handleSubmit}>

            <Form.Group className="mb-3">
              <Form.Label>User ID <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="text"
                value={formData.userid}
                onChange={(e) => setFormData({ ...formData, userid: e.target.value })}
                placeholder="Enter User ID"
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Username <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="Enter username (min 3 characters)"
                required
                minLength={3}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Password <span className="text-danger">*</span></Form.Label>
              <div className="position-relative">
                <Form.Control
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Enter password (min 6 characters)"
                  required
                  minLength={6}
                />
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="position-absolute top-50 end-0 translate-middle-y me-2"
                  style={{ border: 'none', background: 'none' }}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Confirm Password <span className="text-danger">*</span></Form.Label>
              <div className="position-relative">
                <Form.Control
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Confirm your password"
                  required
                />
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="position-absolute top-50 end-0 translate-middle-y me-2"
                  style={{ border: 'none', background: 'none' }}
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Name <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter your full name"
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Role</Form.Label>
              <Form.Select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              >
                <option value="Common">Common</option>
                <option value="IQC">IQC</option>
                <option value="ADMIN">ADMIN</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Division</Form.Label>
              <Form.Select
                value={formData.division}
                onChange={(e) => setFormData({ ...formData, division: e.target.value })}
              >
                <option value="M/P 1">M/P 1</option>
                <option value="M/P 2">M/P 2</option>
                <option value="Common">Common</option>
              </Form.Select>
            </Form.Group>

            <Button
              type="submit"
              variant="primary"
              className="w-100"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Registering...
                </>
              ) : (
                'Register'
              )}
            </Button>
          </Form>

          <div className="text-center mt-3">
            <Button
              variant="link"
              onClick={() => navigate('/login')}
            >
              Already have an account? Login
            </Button>
          </div>
        </Card.Body>
      </Card>

      <style jsx>{`
        .hover-bg-light:hover {
          background-color: #f8f9fa;
        }
        .rotate-180 {
          transform: rotate(180deg);
        }
        .transition-transform {
          transition: transform 0.2s ease;
        }
      `}</style>
    </Container>
  );
  
};


export default Register;