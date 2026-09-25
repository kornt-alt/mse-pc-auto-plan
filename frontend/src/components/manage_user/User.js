import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Table,
  Button,
  Modal,
  Form,
  Alert,
  Badge,
  Spinner,
  InputGroup,
  Row,
  Col,
} from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../shared/PageHeader';
import ConfirmModal from '../shared/ConfirmModal';
import useCardScan from '../shared/useCardScan';
import useTableFilter from '../shared/useTableFilter';
import TableFilterBar from '../shared/TableFilterBar';
import TablePagination from '../shared/TablePagination';

// MC = Material Control (แก้วัน material / Mat'l / Issue ได้ ต้องตรงกับ VALID_ROLES ใน backend/routes/users.js)
const ROLES = ['ADMIN', 'PLANNER', 'MFG', 'MC', 'OPERATOR'];

const emptyForm = {
  username: '',
  password: '',
  role: 'OPERATOR',
  is_active: true,
  full_name: '',
  email: '',
  employee_code: '',
  department: '',
  phone: '',
  card_uid: '',
};

const roleBadge = (role) =>
  role === 'ADMIN' ? 'danger' : role === 'PLANNER' ? 'primary' : role === 'MFG' ? 'info' : role === 'MC' ? 'warning' : 'secondary';

// สถานะรวม status + is_active ไว้ที่เดียว: รออนุมัติ ต้องเด่นกว่าอย่างอื่นเพราะเป็นงานที่ ADMIN ต้องทำ
// ฟิลเตอร์สถานะใช้ฟังก์ชันตัวนี้ด้วย — ป้ายในตารางกับตัวเลือกในฟิลเตอร์จะได้ไม่หลุดจากกัน
const PENDING = 'รออนุมัติ';
const statusLabel = (user) => {
  if (user.status === 'PENDING') return PENDING;
  if (user.status === 'REJECTED') return 'ปฏิเสธแล้ว';
  return user.is_active ? 'ใช้งานอยู่' : 'ระงับ';
};
const STATUS_CHIP = {
  [PENDING]: 'chip-warn',
  'ปฏิเสธแล้ว': 'chip-ng',
  'ใช้งานอยู่': 'chip-ok',
  'ระงับ': 'chip-muted',
};

const StatusChip = ({ user }) => {
  const label = statusLabel(user);
  return <span className={`chip ${STATUS_CHIP[label]}`}>{label}</span>;
};

// ตัวเลือกที่ต้องมีครบเสมอ (สถานะ/Role/บัตร) เขียนไว้ตรง ๆ — ถ้าไล่จากข้อมูล
// ตัวเลือกที่ยังไม่มีใครตรงจะหายไป (ไม่มีใครถูกปฏิเสธ = เลือก "ปฏิเสธแล้ว" ไม่ได้)
// ส่วน "แผนก" ปล่อยให้ไล่จากข้อมูลเอง เพราะแถวเก่าอาจมีค่านอกเหนือจาก 3 ตัวในฟอร์ม
const FILTER_FIELDS = [
  { key: 'username', label: 'Username', type: 'text', width: 150 },
  { key: 'full_name', label: 'ชื่อ-นามสกุล', type: 'text', width: 180 },
  { key: 'employee_code', label: 'รหัสพนักงาน', type: 'text', width: 140 },
  { key: 'email', label: 'อีเมล', type: 'text', width: 180 },
  { key: 'department', label: 'แผนก', type: 'select', width: 140 },
  { key: 'role', label: 'Role', type: 'select', options: ROLES, width: 130 },
  {
    key: 'status_label',
    label: 'สถานะ',
    type: 'select',
    options: [PENDING, 'ใช้งานอยู่', 'ระงับ', 'ปฏิเสธแล้ว'],
    value: statusLabel,
    width: 140,
  },
  {
    key: 'card',
    label: 'บัตร',
    type: 'select',
    options: ['มีบัตร', 'ไม่มีบัตร'],
    value: (u) => (u.card_uid ? 'มีบัตร' : 'ไม่มีบัตร'),
    width: 130,
  },
];

const User = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null); // null = สร้างใหม่
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [approveUser, setApproveUser] = useState(null);
  const [approveRole, setApproveRole] = useState('OPERATOR');
  const [confirm, setConfirm] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('/users');
      setUsers(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // นับจากผู้ใช้ทั้งชุดเสมอ ไม่ใช่ชุดที่กรองแล้ว — เป็นตัวเลขงานค้างของ ADMIN
  const pendingCount = useMemo(
    () => users.filter((u) => u.status === 'PENDING').length,
    [users]
  );

  const table = useTableFilter(users, FILTER_FIELDS, { pageSize: 20 });

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  // แตะบัตรในฟอร์มแก้ไข → เติมค่าลงช่อง card_uid
  const handleCard = useCallback((uid) => setField('card_uid', uid), []);
  const cardScan = useCardScan(handleCard);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyForm);
    cardScan.reset();
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({
      ...emptyForm,
      username: user.username,
      password: '',
      role: user.role,
      is_active: !!user.is_active,
      full_name: user.full_name || '',
      email: user.email || '',
      employee_code: user.employee_code || '',
      department: user.department || '',
      phone: user.phone || '',
      card_uid: user.card_uid || '',
    });
    cardScan.reset();
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const shared = {
        role: form.role,
        full_name: form.full_name,
        email: form.email,
        employee_code: form.employee_code,
        department: form.department,
        phone: form.phone,
        card_uid: form.card_uid,
      };
      if (editUser) {
        const body = { ...shared, is_active: form.is_active };
        if (form.password) body.password = form.password;
        await apiCall(`/users/${editUser.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiCall('/users', {
          method: 'POST',
          body: JSON.stringify({ ...shared, username: form.username, password: form.password }),
        });
      }
      setShowModal(false);
      setError('');
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // อนุมัติ = กำหนด role + เปิดใช้งาน + เปลี่ยนสถานะเป็น ACTIVE ในครั้งเดียว
  const handleApprove = async () => {
    setSaving(true);
    try {
      await apiCall(`/users/${approveUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: approveRole, status: 'ACTIVE', is_active: true }),
      });
      setApproveUser(null);
      setError('');
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = useCallback(
    async (user) => {
      try {
        await apiCall(`/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'REJECTED', is_active: false }),
        });
        setError('');
        fetchUsers();
      } catch (err) {
        setError(err.message);
      }
    },
    [fetchUsers]
  );

  const askReject = (user) =>
    setConfirm({
      title: 'ปฏิเสธคำขอใช้งาน',
      body: `ยืนยันปฏิเสธคำขอของ ${user.full_name || user.username}? ผู้ใช้จะเข้าระบบไม่ได้`,
      confirmLabel: 'ปฏิเสธคำขอ',
      variant: 'danger',
      onConfirm: () => handleReject(user),
    });

  return (
    <Container fluid className="py-3">
      <PageHeader
        icon="bi-people"
        title="จัดการผู้ใช้งาน"
        subtitle="อนุมัติคำขอ กำหนดสิทธิ์ และลงทะเบียนบัตรเข้าใช้งาน"
        status={
          pendingCount > 0 ? (
            // กดแล้วกรองเฉพาะที่รออนุมัติ — แทนสวิตช์เดิมที่ถอดออกไปเพราะฟิลเตอร์สถานะครอบคลุมแล้ว
            <Button
              variant="warning"
              size="sm"
              className="py-0"
              title="กรองเฉพาะที่รออนุมัติ"
              aria-label={`กรองเฉพาะผู้ใช้ที่รออนุมัติ ${pendingCount} คน`}
              onClick={() => table.setFilter('status_label', PENDING)}
            >
              รออนุมัติ {pendingCount} คน
            </Button>
          ) : null
        }
        actions={
          <Button className="btn-mse" onClick={openCreate}>
            <i className="bi bi-person-plus me-1" aria-hidden="true" /> เพิ่มผู้ใช้
          </Button>
        }
      />

      <TableFilterBar
        id="user-filter"
        fields={FILTER_FIELDS}
        filters={table.filters}
        options={table.options}
        activeCount={table.activeCount}
        onChange={table.setFilter}
        onReset={table.resetFilters}
      />

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : table.rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-people" aria-hidden="true" />
          {table.activeCount > 0 ? (
            <>
              <div>ไม่มีผู้ใช้ตรงกับฟิลเตอร์ที่เลือก</div>
              <Button
                size="sm"
                variant="outline-secondary"
                className="mt-2"
                onClick={table.resetFilters}
              >
                <i className="bi bi-x-circle me-1" aria-hidden="true" />
                ล้างฟิลเตอร์
              </Button>
            </>
          ) : (
            <div>ยังไม่มีผู้ใช้ในระบบ</div>
          )}
        </div>
      ) : (
        <>
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>Username</th>
              <th>ชื่อ-นามสกุล</th>
              <th>รหัสพนักงาน</th>
              <th>แผนก</th>
              <th>อีเมล</th>
              <th>บัตร</th>
              <th>Role</th>
              <th>สถานะ</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((u) => (
              <tr key={u.id}>
                <td className="num">{u.username}</td>
                <td>{u.full_name || '-'}</td>
                <td className="num">{u.employee_code || '-'}</td>
                <td>{u.department || '-'}</td>
                <td>{u.email || '-'}</td>
                <td className="text-center">
                  {u.card_uid ? (
                    <i
                      className="bi bi-credit-card-2-front-fill"
                      title="ลงทะเบียนบัตรแล้ว"
                      aria-label="ลงทะเบียนบัตรแล้ว"
                      style={{ color: 'var(--mse-ok)' }}
                    />
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  <Badge bg={roleBadge(u.role)}>{u.role}</Badge>
                </td>
                <td>
                  <StatusChip user={u} />
                </td>
                <td className="text-center">
                  {u.status === 'PENDING' && (
                    <>
                      <Button
                        variant="success"
                        size="sm"
                        className="me-1"
                        title="อนุมัติ"
                        aria-label={`อนุมัติผู้ใช้ ${u.username}`}
                        onClick={() => {
                          setApproveUser(u);
                          setApproveRole(u.role || 'OPERATOR');
                        }}
                      >
                        <i className="bi bi-check-lg" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="me-1"
                        title="ปฏิเสธคำขอ"
                        aria-label={`ปฏิเสธคำขอของ ${u.username}`}
                        onClick={() => askReject(u)}
                      >
                        <i className="bi bi-x-lg" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline-primary"
                    size="sm"
                    title="แก้ไข"
                    aria-label={`แก้ไขผู้ใช้ ${u.username}`}
                    onClick={() => openEdit(u)}
                  >
                    <i className="bi bi-pencil-square" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TablePagination
          id="user"
          unit="คน"
          page={table.page}
          pageCount={table.pageCount}
          pageSize={table.pageSize}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          from={table.from}
          to={table.to}
          filteredCount={table.filteredCount}
          total={table.total}
        />
        </>
      )}

      {/* ===== เพิ่ม / แก้ไขผู้ใช้ ===== */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{editUser ? `แก้ไขผู้ใช้: ${editUser.username}` : 'เพิ่มผู้ใช้ใหม่'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row>
            {!editUser && (
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Username</Form.Label>
                  <Form.Control
                    value={form.username}
                    onChange={(e) => setField('username', e.target.value)}
                    placeholder="ภาษาอังกฤษ/ตัวเลข เท่านั้น"
                  />
                </Form.Group>
              </Col>
            )}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{editUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'Password'}</Form.Label>
                <Form.Control
                  type="password"
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  autoComplete="new-password"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>ชื่อ-นามสกุล</Form.Label>
                <Form.Control
                  value={form.full_name}
                  onChange={(e) => setField('full_name', e.target.value)}
                  placeholder="ภาษาไทยได้"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>รหัสพนักงาน</Form.Label>
                <Form.Control
                  value={form.employee_code}
                  onChange={(e) => setField('employee_code', e.target.value)}
                  placeholder="ภาษาอังกฤษ/ตัวเลข เท่านั้น"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>อีเมล</Form.Label>
                <Form.Control
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>แผนก</Form.Label>
                {/* <Form.Control
                  value={form.department}
                  onChange={(e) => setField('department', e.target.value)}
                  placeholder="ภาษาไทยได้"
                /> */}
                <Form.Select
                  name="department"
                  value={form.department}
                  onChange={(e) => setField('department', e.target.value)}
                >
                  <option value="">-- กรุณาเลือกแผนก --</option>
                  <option value="MSE">MSE</option>
                  <option value="MECHA2">MECHA2</option>
                  <option value="MECHA1">MECHA1</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>เบอร์โทร</Form.Label>
                <Form.Control
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Role</Form.Label>
                <Form.Select value={form.role} onChange={(e) => setField('role', e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group className="mb-3">
                <Form.Label>ลงทะเบียนบัตร (แตะบัตรที่เครื่องอ่าน)</Form.Label>
                <InputGroup>
                  <InputGroup.Text>
                    <i className="bi bi-credit-card-2-front" aria-hidden="true" />
                  </InputGroup.Text>
                  <Form.Control
                    value={form.card_uid}
                    onChange={(e) => {
                      setField('card_uid', e.target.value);
                      cardScan.onChange(e);
                    }}
                    onKeyDown={cardScan.onKeyDown}
                    placeholder="แตะบัตร หรือพิมพ์รหัสบัตร"
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => {
                      cardScan.reset();
                      setField('card_uid', '');
                    }}
                  >
                    ล้างบัตร
                  </Button>
                </InputGroup>
                <Form.Text className="text-muted">
                  เว้นว่าง = ผู้ใช้คนนี้ไม่มีบัตร (แตะบัตรเข้าระบบไม่ได้)
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>
          {editUser && (
            <Form.Check
              type="switch"
              label="เปิดใช้งานบัญชี"
              checked={form.is_active}
              onChange={(e) => setField('is_active', e.target.checked)}
            />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'บันทึก'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ===== อนุมัติคำขอ ===== */}
      <Modal show={!!approveUser} onHide={() => setApproveUser(null)}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.05rem' }}>อนุมัติคำขอใช้งาน</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {approveUser && (
            <>
              <p className="mb-3">
                <strong>{approveUser.full_name || approveUser.username}</strong>
                <br />
                <span className="text-muted small">
                  Username: {approveUser.username} · รหัสพนักงาน: {approveUser.employee_code || '-'} ·
                  แผนก: {approveUser.department || '-'}
                </span>
              </p>
              <Form.Group>
                <Form.Label>กำหนดสิทธิ์การใช้งาน (Role)</Form.Label>
                <Form.Select value={approveRole} onChange={(e) => setApproveRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setApproveUser(null)}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={handleApprove} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'อนุมัติและเปิดใช้งาน'}
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
    </Container>
  );
};

export default User;
