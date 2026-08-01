import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Form, Button, Alert, Spinner, InputGroup, Row, Col } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import useCardScan from '../shared/useCardScan';

// สมัครใช้งานเอง — บัญชีที่ได้ยังเข้าระบบไม่ได้จนกว่า ADMIN จะอนุมัติและกำหนด role
// ตรวจฝั่งนี้ให้ผู้ใช้รู้ตัวเร็ว แต่ backend (routes/auth.js + utils/validate.js) คือด่านจริง
const IDENTIFIER_RE = /^[A-Za-z0-9._-]{3,10}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const emptyForm = {
  username: '',
  password: '',
  confirmPassword: '',
  full_name: '',
  email: '',
  employee_code: '',
  department: 'MSE',
  phone: '',
  card_uid: '',
};

const Register = () => {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null); // { mailSent, mailError }

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const handleChange = (e) => setField(e.target.name, e.target.value);

  // แตะบัตรเพื่อลงทะเบียน (ไม่บังคับ) — เติมค่าลงช่อง ไม่ได้ส่งอะไรทันที
  const handleCard = useCallback((uid) => setField('card_uid', uid), []);
  const cardScan = useCardScan(handleCard);

  const validate = () => {
    if (!IDENTIFIER_RE.test(form.username.trim())) {
      return 'Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3-10 ตัว (ห้ามภาษาไทยและเว้นวรรค)';
    }
    if (form.password.length < 4) {
      return 'รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร';
    }
    if (form.password !== form.confirmPassword) {
      return 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    }
    if (!form.full_name.trim()) {
      return 'กรุณากรอกชื่อ-นามสกุล';
    }
    if (!EMAIL_RE.test(form.email.trim())) {
      return 'รูปแบบอีเมลไม่ถูกต้อง';
    }
    if (!IDENTIFIER_RE.test(form.employee_code.trim())) {
      return 'รหัสพนักงานต้องเป็นภาษาอังกฤษหรือตัวเลข ยาว 3-10 ตัว (ห้ามภาษาไทยและเว้นวรรค)';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiCall('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          full_name: form.full_name,
          email: form.email,
          employee_code: form.employee_code,
          department: form.department,
          phone: form.phone,
          card_uid: form.card_uid,
        }),
      });
      setDone({ mailSent: res.mailSent, mailError: res.mailError });
    } catch (err) {
      setError(err.message || 'สมัครใช้งานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const shell = (children, maxWidth) => (
    <div
      className="d-flex align-items-center justify-content-center p-4"
      style={{ minHeight: '100vh', backgroundColor: 'var(--mse-canvas)' }}
    >
      <Card className="w-100 shadow" style={{ maxWidth }}>
        <div
          className="text-center text-white px-4 py-4"
          style={{
            backgroundColor: 'var(--mse-primary)',
            borderTopLeftRadius: 'var(--mse-radius)',
            borderTopRightRadius: 'var(--mse-radius)',
          }}
        >
          <i className="bi bi-person-plus" style={{ fontSize: '2.75rem' }} aria-hidden="true" />
          <h1 className="fw-bold mb-0 mt-2" style={{ fontSize: 'var(--fs-page)' }}>
            สมัครใช้งาน
          </h1>
          <p className="mb-0 small" style={{ opacity: 0.85 }}>
            MSE Auto Plan — ระบบวางแผนการผลิต
          </p>
        </div>
        <Card.Body className="p-4">{children}</Card.Body>
      </Card>
    </div>
  );

  if (done) {
    return shell(
      <>
        <div className="text-center">
          <i
            className="bi bi-check-circle-fill"
            style={{ fontSize: '3rem', color: 'var(--mse-ok)' }}
            aria-hidden="true"
          />
          <h2 className="mt-3" style={{ fontSize: 'var(--fs-section)' }}>
            ส่งคำขอใช้งานแล้ว
          </h2>
          <p className="text-muted">
            บัญชีของคุณจะเข้าใช้งานได้เมื่อผู้ดูแลระบบอนุมัติและกำหนดสิทธิ์ให้เรียบร้อย
          </p>
        </div>
        {!done.mailSent && (
          <Alert variant="warning" className="py-2 small">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            ระบบส่งอีเมลแจ้งผู้ดูแลไม่สำเร็จ ({done.mailError || 'ไม่ทราบสาเหตุ'}) — กรุณาแจ้ง ADMIN
            โดยตรงอีกทาง
          </Alert>
        )}
        <Link to="/login" className="btn btn-mse w-100 touch-target mt-2">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </>,
      '480px'
    );
  }

  return shell(
    <>
      {error && (
        <Alert variant="danger" className="d-flex align-items-center py-2">
          <i className="bi bi-exclamation-circle-fill me-2 flex-shrink-0" aria-hidden="true" />
          {error}
        </Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>
                Username <span style={{ color: 'var(--mse-ng)' }}>*</span>
              </Form.Label>
              <Form.Control
                name="username"
                value={form.username}
                onChange={handleChange}
                placeholder="ภาษาอังกฤษ/ตัวเลข"
                autoComplete="username"
                autoFocus
              />
              <Form.Text className="text-muted">ใช้ภาษาอังกฤษหรือตัวเลขเท่านั้น</Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>
                รหัสพนักงาน <span style={{ color: 'var(--mse-ng)' }}>*</span>
              </Form.Label>
              <Form.Control
                name="employee_code"
                value={form.employee_code}
                onChange={handleChange}
                placeholder="เช่น 12345"
              />
            </Form.Group>
          </Col>
        </Row>

        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>
                รหัสผ่าน <span style={{ color: 'var(--mse-ng)' }}>*</span>
              </Form.Label>
              <Form.Control
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                autoComplete="new-password"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>
                ยืนยันรหัสผ่าน <span style={{ color: 'var(--mse-ng)' }}>*</span>
              </Form.Label>
              <Form.Control
                type="password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                autoComplete="new-password"
              />
            </Form.Group>
          </Col>
        </Row>

        <Form.Group className="mb-3">
          <Form.Label>
            ชื่อ-นามสกุล <span style={{ color: 'var(--mse-ng)' }}>*</span>
          </Form.Label>
          <Form.Control
            name="full_name"
            value={form.full_name}
            onChange={handleChange}
            placeholder="ภาษาไทยได้"
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>
            อีเมล <span style={{ color: 'var(--mse-ng)' }}>*</span>
          </Form.Label>
          <Form.Control
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            autoComplete="email"
          />
        </Form.Group>

        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>แผนก</Form.Label>
              <Form.Select
                name="department"
                value={form.department}
                onChange={handleChange}
              >
                <option value="">-- กรุณาเลือกแผนก --</option>
                <option value="MSE">MSE</option>
                <option value="MECHA2">MECHA2</option>
                <option value="MECHA1">MECHA1</option>
              </Form.Select>
            </Form.Group>
          </Col>
          {/* <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>เบอร์โทร</Form.Label>
              <Form.Control name="phone" value={form.phone} onChange={handleChange} />
            </Form.Group>
          </Col> */}
        </Row>

        <Form.Group className="mb-4">
          <Form.Label>ลงทะเบียนบัตร (ไม่บังคับ)</Form.Label>
          <InputGroup>
            <InputGroup.Text>
              <i className="bi bi-credit-card-2-front" aria-hidden="true" />
            </InputGroup.Text>
            <Form.Control
              value={form.card_uid}
              onChange={(e) => {
                // ช่องเดียวรับได้ทั้งการแตะบัตรและการพิมพ์เอง — cardScan คุมจังหวะ "อ่านจบ"
                setField('card_uid', e.target.value);
                cardScan.onChange(e);
              }}
              onKeyDown={cardScan.onKeyDown}
              placeholder="แตะบัตรที่เครื่องอ่าน"
            />
            <Button
              variant="outline-secondary"
              type="button"
              onClick={() => {
                cardScan.reset();
                setField('card_uid', '');
              }}
            >
              ล้าง
            </Button>
          </InputGroup>
          {form.card_uid && (
            <Form.Text style={{ color: 'var(--mse-ok)' }}>
              <i className="bi bi-check-circle me-1" aria-hidden="true" />
              รับค่าจากบัตรแล้ว
            </Form.Text>
          )}
        </Form.Group>

        <Button type="submit" className="w-100 btn-mse touch-target" disabled={loading}>
          {loading ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              กำลังส่งคำขอ...
            </>
          ) : (
            'ส่งคำขอใช้งาน'
          )}
        </Button>

        <div className="text-center small mt-3">
          มีบัญชีอยู่แล้ว?{' '}
          <Link to="/login" className="text-mse fw-bold">
            เข้าสู่ระบบ
          </Link>
        </div>
      </Form>
    </>,
    '620px'
  );
};

export default Register;
