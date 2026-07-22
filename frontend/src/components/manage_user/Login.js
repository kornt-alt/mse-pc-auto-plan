import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Card, Form, Button, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import useScanInput from '../shared/useScanInput';
import useCardScan from '../shared/useCardScan';

// 3 วิธีเข้าสู่ระบบ แต่มี 2 หน้าจอ:
//   mode = 'password' — แตะบัตร RFID (อยู่บนสุด เครื่องอ่านจ่ออยู่แล้วต้องแตะได้ทันที)
//                       คั่นด้วย "หรือ" แล้วตามด้วย Username/Password
//   mode = 'code'     — กรอกรหัสพนักงาน แล้วเด้งไปหน้า Shop Floor เลย (ไม่มีบัญชีก็เข้าได้)
const Login = () => {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  // ระบุด้วยว่ากำลังยิงทางไหนอยู่ — สปินเนอร์จะได้ขึ้นที่เดียว (ช่องบัตรไม่มีปุ่มของตัวเอง)
  const [busy, setBusy] = useState(''); // '' | 'card' | 'password' | 'code'
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState('password');

  const loading = Boolean(busy);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
  };

  // เก็บ token/user แล้วพาไปหน้าถัดไป — ใช้ร่วมกันทั้ง 3 วิธี
  const finishLogin = useCallback(
    (data, target) => {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate(target, { replace: true });
    },
    [navigate]
  );

  // ===== กรอก/สแกนรหัสพนักงาน → Shop Floor =====
  const handleCodeLogin = useCallback(
    async (code) => {
      const c = String(code ?? '').trim();
      if (!c) {
        setError('กรุณากรอกรหัสพนักงาน');
        return;
      }
      setBusy('code');
      setError('');
      try {
        const data = await apiCall('/auth/login-scan', {
          method: 'POST',
          body: JSON.stringify({ code: c }),
        });
        // ไปหน้าไลน์ผลิตตรง ๆ ไม่ใช้ from — คนที่กรอกรหัสคือคนหน้างาน
        finishLogin(data, '/shop-floor');
      } catch (err) {
        setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      } finally {
        setBusy('');
      }
    },
    [finishLogin]
  );

  // ยิงเมื่อครบ 5 ตัว (รหัสเดิม) แต่ปุ่ม/Enter ใช้ได้เสมอ — รหัสใหม่ยาวได้ถึง 20 ตัว
  const codeScan = useScanInput(5, handleCodeLogin);

  // ===== แตะบัตร =====
  const handleCardLogin = useCallback(
    async (uid) => {
      setBusy('card');
      setError('');
      try {
        const data = await apiCall('/auth/login-card', {
          method: 'POST',
          body: JSON.stringify({ card_uid: uid }),
        });
        finishLogin(data, from);
      } catch (err) {
        setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      } finally {
        setBusy('');
      }
    },
    [finishLogin, from]
  );

  const cardScan = useCardScan(handleCardLogin);
  const cardReset = cardScan.reset;
  const codeReset = codeScan.reset;

  // เข้าไม่สำเร็จ → ล้างช่องให้ว่าง ไม่งั้นการแตะบัตร/กรอกรหัสรอบถัดไปจะไปต่อท้ายค่าเดิม
  // ช่องบัตรอยู่คู่กับฟอร์ม Username/Password แล้ว จึงล้างทุกครั้งที่ไม่ได้อยู่หน้ากรอกรหัสพนักงาน
  useEffect(() => {
    if (!error) return;
    if (mode === 'code') codeReset();
    else cardReset();
  }, [error, mode, cardReset, codeReset]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.username || !formData.password) {
      setError('กรุณากรอก Username และ Password');
      return;
    }
    setBusy('password');
    setError('');

    try {
      const data = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: formData.username.trim(),
          password: formData.password,
        }),
      });
      finishLogin(data, from);
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  };

  return (
    <div
      className="d-flex align-items-center justify-content-center p-4"
      style={{ minHeight: '100vh', backgroundColor: 'var(--mse-canvas)' }}
    >
      <Card className="w-100 shadow" style={{ maxWidth: '400px' }}>
        <div
          className="text-center text-white px-4 py-4"
          style={{
            backgroundColor: 'var(--mse-primary)',
            borderTopLeftRadius: 'var(--mse-radius)',
            borderTopRightRadius: 'var(--mse-radius)',
          }}
        >
          <i className="bi bi-building-gear" style={{ fontSize: '2.75rem' }} aria-hidden="true" />
          <h1 className="fw-bold mb-0 mt-2" style={{ fontSize: 'var(--fs-page)' }}>
            MSE Auto Plan
          </h1>
          <p className="mb-0 small" style={{ opacity: 0.85 }}>
            ระบบวางแผนการผลิต
          </p>
        </div>
        <Card.Body className="p-4">

          {error && (
            <Alert variant="danger" className="d-flex align-items-center py-2">
              <i className="bi bi-exclamation-circle-fill me-2 flex-shrink-0" aria-hidden="true" />
              {error}
            </Alert>
          )}

          {mode === 'password' && (
            <>
              {/* บล็อกแตะบัตร — อยู่นอก <Form> ไม่งั้น Enter ที่เครื่องอ่านเคาะท้าย UID จะไป submit ฟอร์มรหัสผ่าน */}
              <div className="text-center mb-3">
                <i
                  className="bi bi-credit-card-2-front text-mse"
                  style={{ fontSize: '2.5rem' }}
                  aria-hidden="true"
                />
                <div className="mt-1">แตะบัตรที่เครื่องอ่านได้เลย</div>
              </div>
              <Form.Group className="mb-2">
                <Form.Label>รหัสบัตร</Form.Label>
                <Form.Control
                  type="password"
                  value={cardScan.value}
                  onChange={cardScan.onChange}
                  onKeyDown={cardScan.onKeyDown}
                  placeholder="รอรับค่าจากเครื่องอ่านบัตร"
                  className="touch-target"
                  autoFocus
                  disabled={loading}
                />
              </Form.Group>

              {busy === 'card' && (
                <div className="text-center mb-2">
                  <Spinner animation="border" size="sm" className="me-2" />
                  กำลังเข้าสู่ระบบ...
                </div>
              )}

              <div className="d-flex align-items-center my-3 text-muted small">
                <hr className="flex-grow-1 my-0" />
                <span className="mx-2">หรือ</span>
                <hr className="flex-grow-1 my-0" />
              </div>

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
                    disabled={loading}
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
                      disabled={loading}
                    />
                    <Button
                      variant="link"
                      size="sm"
                      className="position-absolute top-50 end-0 translate-middle-y me-1 text-muted"
                      onClick={() => setShowPassword(!showPassword)}
                      type="button"
                      tabIndex={-1}
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
                    </Button>
                  </div>
                </Form.Group>

                <Button type="submit" className="w-100 btn-mse touch-target" disabled={loading}>
                  {busy === 'password' ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      กำลังเข้าสู่ระบบ...
                    </>
                  ) : (
                    'เข้าสู่ระบบ'
                  )}
                </Button>

                <div className="d-grid mt-2">
                  <Button
                    variant="link"
                    className="text-mse"
                    type="button"
                    onClick={() => switchMode('code')}
                  >
                    <i className="bi bi-person-badge me-1" aria-hidden="true" />
                    กรอกรหัสพนักงาน (เข้าหน้าไลน์ผลิต)
                  </Button>
                </div>

                <hr className="my-3" />
                <div className="text-center small">
                  ยังไม่มีบัญชี?{' '}
                  <Link to="/register" className="text-mse fw-bold">
                    สมัครใช้งาน
                  </Link>
                </div>
              </Form>
            </>
          )}

          {mode === 'code' && (
            <>
              <Form.Group className="mb-1">
                <Form.Label>รหัสพนักงาน</Form.Label>
                <InputGroup>
                  <InputGroup.Text>
                    <i className="bi bi-person-badge" aria-hidden="true" />
                  </InputGroup.Text>
                  <Form.Control
                    type="password"
                    value={codeScan.value}
                    onChange={codeScan.onChange}
                    onKeyDown={codeScan.onKeyDown}
                    placeholder="กรอกรหัสพนักงาน"
                    className="touch-target"
                    autoFocus
                    disabled={loading}
                  />
                </InputGroup>
              </Form.Group>
              <div className="text-muted small mb-3">
                ยังไม่มีบัญชีในระบบก็เข้าใช้งานหน้าไลน์ผลิตได้
              </div>
              <Button
                className="w-100 btn-mse touch-target mb-2"
                disabled={loading}
                onClick={() => handleCodeLogin(codeScan.value)}
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
                className="w-100 text-mse"
                onClick={() => {
                  codeReset();
                  switchMode('password');
                }}
              >
                เข้าสู่ระบบด้วย Username / Password
              </Button>
            </>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default Login;
