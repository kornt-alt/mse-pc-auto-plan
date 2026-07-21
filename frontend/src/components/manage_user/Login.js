import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { Factory, AlertCircle, Eye, EyeOff, QrCode } from 'lucide-react';
import { apiCall } from '../../api/client';
import useScanInput from '../shared/useScanInput';

const Login = () => {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [scanMode, setScanMode] = useState(false); // โหมดสแกนรหัสพนักงาน (OPERATOR)

  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // สแกนรหัสพนักงาน 5 ตัว → login-scan อัตโนมัติ (HomeRedirect พา OPERATOR ไป /shop-floor)
  const scan = useScanInput(5, (code) => handleScanLogin(code));

  async function handleScanLogin(code) {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiCall('/auth/login-scan', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      scan.reset();
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.username || !formData.password) {
      setError('กรุณากรอก Username และ Password');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const data = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: formData.username.trim(),
          password: formData.password,
        }),
      });

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="d-flex align-items-center justify-content-center p-4"
      style={{ minHeight: '100vh', backgroundColor: '#f0f2f5' }}
    >
      <Card className="w-100 shadow" style={{ maxWidth: '400px', borderRadius: '12px' }}>
        <Card.Body className="p-4">
          <div className="text-center mb-4">
            <Factory size={48} className="text-mse mb-2" />
            <h2 className="fw-bold text-mse">MES System</h2>
            <p className="text-muted">เข้าสู่ระบบเพื่อใช้งาน</p>
          </div>

          {error && (
            <Alert variant="danger" className="d-flex align-items-center py-2">
              <AlertCircle size={16} className="me-2 flex-shrink-0" />
              {error}
            </Alert>
          )}

          {scanMode ? (
            <>
              <Form.Group className="mb-4">
                <Form.Label>รหัสพนักงาน (สแกน/พิมพ์)</Form.Label>
                <Form.Control
                  type="password"
                  value={scan.value}
                  onChange={scan.onChange}
                  onKeyDown={scan.onKeyDown}
                  placeholder="สแกนรหัสพนักงาน 5 ตัว"
                  autoFocus
                  disabled={loading}
                />
              </Form.Group>
              {loading && (
                <div className="text-center mb-3">
                  <Spinner animation="border" size="sm" className="me-2" />
                  กำลังเข้าสู่ระบบ...
                </div>
              )}
              <Button
                variant="link"
                className="w-100 text-mse"
                onClick={() => {
                  setScanMode(false);
                  setError('');
                }}
              >
                เข้าสู่ระบบด้วย Username / Password
              </Button>
            </>
          ) : (
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="Username"
                autoComplete="username"
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-4">
              <Form.Label>Password</Form.Label>
              <div className="position-relative">
                <Form.Control
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Password"
                  autoComplete="current-password"
                />
                <Button
                  variant="link"
                  size="sm"
                  className="position-absolute top-50 end-0 translate-middle-y me-1 text-muted"
                  onClick={() => setShowPassword(!showPassword)}
                  type="button"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </Form.Group>

            <Button
              type="submit"
              className="w-100 btn-mse"
              style={{ height: '48px' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  กำลังเข้าสู่ระบบ...
                </>
              ) : (
                'เข้าสู่ระบบ'
              )}
            </Button>
            <Button
              variant="link"
              className="w-100 text-mse mt-2"
              type="button"
              onClick={() => {
                setScanMode(true);
                setError('');
              }}
            >
              <QrCode size={16} className="me-1" />
              เข้าสู่ระบบด้วยรหัสพนักงาน (สแกน)
            </Button>
          </Form>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default Login;
