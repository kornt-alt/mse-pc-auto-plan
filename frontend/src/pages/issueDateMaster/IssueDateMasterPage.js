// Issue Date Master — โมเดลไหนต้องปล่อยเอกสารล่วงหน้ากี่ "วันทำงาน" ก่อนวันเริ่มผลิต
//
// ค่าจากหน้านี้ถูกใช้ตอนรันแผน: ระบบเขียน orders.issue_date = start_date ถอยหลัง N วันทำงาน
// (ข้ามเสาร์-อาทิตย์และวันหยุดจาก master_holidays) แล้วโชว์ในคอลัมน์ Issue Date ของหน้า Orders
//
// ⚠️ โมเดลที่ "ไม่มีแถวในหน้านี้" ไม่ได้แปลว่าไม่มีวัน Issue — มันใช้ค่า default (backend เป็นคนบอกมา
// ผ่าน default_lead_days) ข้อความบนหน้าต้องพูดเรื่องนี้ให้ชัด ไม่งั้นผู้ใช้จะเข้าใจว่าต้องกรอกครบทุกรุ่น
import React, { useState, useEffect, useCallback } from 'react';
import { Container, Card, Table, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import ConfirmModal from '../../components/shared/ConfirmModal';
import useTableFilter from '../../components/shared/useTableFilter';
import TableFilterBar from '../../components/shared/TableFilterBar';
import TablePagination from '../../components/shared/TablePagination';

// ⚠️ ต้องเป็น module constant ไม่ใช่ useMemo — useTableFilter ผูกกับ identity ของอาร์เรย์นี้
const FILTER_FIELDS = [
  { key: 'model', label: 'Model', type: 'text', width: 220 },
  { key: 'note', label: 'หมายเหตุ', type: 'text', width: 220 },
];

const LEAD_MAX = 365;
const EMPTY_FORM = { model: '', lead_days: '', note: '' };

const fmtUpdated = (row) => {
  if (!row.updated_at) return '-';
  const d = new Date(row.updated_at);
  if (Number.isNaN(d.getTime())) return '-';
  const date = d.toLocaleDateString('en-CA');
  return row.updated_by ? `${date} · ${row.updated_by}` : date;
};

const IssueDateMasterPage = () => {
  const [rows, setRows] = useState([]);
  const [defaultLead, setDefaultLead] = useState(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // null = ปิด · { ...EMPTY_FORM, isEdit }
  const [confirm, setConfirm] = useState(null);
  const { toast, showToast, hideToast } = useToast();

  const showError = useCallback((msg) => showToast(msg, 'danger'), [showToast]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall('/issue-date-master');
      setRows(res.data || []);
      if (res.default_lead_days !== undefined) setDefaultLead(res.default_lead_days);
    } catch (err) {
      showError(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const table = useTableFilter(rows, FILTER_FIELDS, { pageSize: 20 });

  const openAdd = () => setForm({ ...EMPTY_FORM, isEdit: false });
  const openEdit = (row) =>
    setForm({
      model: row.model,
      lead_days: String(row.lead_days ?? ''),
      note: row.note || '',
      isEdit: true,
    });

  const handleSave = async () => {
    const model = form.model.trim();
    if (!model) return showError('ต้องระบุชื่อโมเดล');
    const lead = Number(form.lead_days);
    if (
      String(form.lead_days).trim() === '' ||
      !Number.isInteger(lead) || lead < 0 || lead > LEAD_MAX
    ) {
      return showError(`จำนวนวันต้องเป็นจำนวนเต็ม 0 ถึง ${LEAD_MAX}`);
    }

    setBusy(true);
    try {
      await apiCall(`/issue-date-master/${encodeURIComponent(model)}`, {
        method: 'PUT',
        body: JSON.stringify({ lead_days: lead, note: form.note.trim() }),
      });
      setForm(null);
      showToast(`บันทึก ${model} = ${lead} วันทำงานแล้ว`);
      fetchRows();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const askDelete = (row) =>
    setConfirm({
      title: 'ลบโมเดลออกจากตาราง',
      body: `ลบ '${row.model}' ออกจากตารางนี้? โมเดลนี้จะกลับไปใช้ค่า default ${defaultLead} วันทำงาน`,
      confirmLabel: 'ลบ',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const res = await apiCall(`/issue-date-master/${encodeURIComponent(row.model)}`, {
            method: 'DELETE',
          });
          showToast(res.message);
          fetchRows();
        } catch (err) {
          showError(err.message);
        }
      },
    });

  return (
    <Container fluid className="py-3">
      <PageHeader
        icon="bi-file-earmark-text"
        title="Issue Date Master"
        subtitle="จำนวนวันที่ต้องปล่อยเอกสารล่วงหน้าก่อนวันเริ่มผลิต แยกตามโมเดล"
      />

      <div className="alert alert-info py-2 small d-flex align-items-center gap-2">
        <i className="bi bi-info-circle-fill" aria-hidden="true" />
        <span>
          นับเป็น <b>วันทำงาน</b> (ข้ามเสาร์-อาทิตย์และวันหยุดโรงงาน) โดยถอยหลังจากวันเริ่มผลิต ·
          โมเดลที่ <b>ไม่อยู่ในตารางนี้</b> ใช้ค่า default <b>{defaultLead} วันทำงาน</b> ไม่ใช่ไม่มีวัน Issue
        </span>
      </div>

      <TableFilterBar
        id="issue-date-filter"
        fields={FILTER_FIELDS}
        filters={table.filters}
        options={table.options}
        activeCount={table.activeCount}
        onChange={table.setFilter}
        onReset={table.resetFilters}
      />

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-bold">
            {table.activeCount > 0
              ? `โมเดลที่ตรงฟิลเตอร์ (${table.filteredCount} จาก ${table.total})`
              : `โมเดลที่ตั้งค่าไว้ (${table.total})`}
          </span>
          <Button size="sm" className="btn-mse" onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มโมเดล
          </Button>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center my-3">
              <Spinner animation="border" className="text-mse" />
            </div>
          ) : table.total === 0 ? (
            <div className="empty-state">
              <i className="bi bi-inbox" aria-hidden="true" />
              <div>ยังไม่ได้ตั้งค่าโมเดลไหนเลย — ทุกโมเดลใช้ค่า default {defaultLead} วันทำงาน</div>
            </div>
          ) : (
            <Table hover size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="text-end" style={{ width: 140 }}>วันล่วงหน้า</th>
                  <th>หมายเหตุ</th>
                  <th style={{ width: 200 }}>แก้ล่าสุด</th>
                  <th style={{ width: 90 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.model}>
                    <td className="num fw-bold">{row.model}</td>
                    <td className="num text-end">{row.lead_days}</td>
                    <td className="text-truncate" style={{ maxWidth: 260 }} title={row.note || ''}>
                      {row.note || '-'}
                    </td>
                    <td className="num small text-muted">{fmtUpdated(row)}</td>
                    <td className="text-nowrap">
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 me-2 text-primary icon-btn"
                        title="แก้ไข"
                        aria-label={`แก้ไข ${row.model}`}
                        onClick={() => openEdit(row)}
                      >
                        <i className="bi bi-pencil-square" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-danger icon-btn"
                        title="ลบ"
                        aria-label={`ลบ ${row.model}`}
                        onClick={() => askDelete(row)}
                      >
                        <i className="bi bi-trash" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {!loading && table.filteredCount > 0 && (
        <TablePagination
          id="issue-date"
          unit="โมเดล"
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
      )}

      <Modal show={form !== null} onHide={() => setForm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6">
            <i className="bi bi-file-earmark-text me-2" aria-hidden="true" />
            {form && form.isEdit ? 'แก้ไขจำนวนวันล่วงหน้า' : 'เพิ่มโมเดล'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {form && (
            <>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="idm-model">Model</Form.Label>
                <Form.Control
                  id="idm-model"
                  value={form.model}
                  disabled={form.isEdit}
                  placeholder="เช่น KT12132-3"
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="idm-lead">จำนวนวันทำงานล่วงหน้า</Form.Label>
                <Form.Control
                  id="idm-lead"
                  type="number"
                  min={0}
                  max={LEAD_MAX}
                  value={form.lead_days}
                  placeholder={String(defaultLead)}
                  onChange={(e) => setForm((f) => ({ ...f, lead_days: e.target.value }))}
                />
                <Form.Text className="text-muted">
                  ถอยหลังจากวันเริ่มผลิต นับเฉพาะวันทำงาน · 0 = ปล่อยเอกสารวันเดียวกับวันเริ่ม
                </Form.Text>
              </Form.Group>
              <Form.Group>
                <Form.Label htmlFor="idm-note">หมายเหตุ</Form.Label>
                <Form.Control
                  id="idm-note"
                  as="textarea"
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                />
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setForm(null)} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={handleSave} disabled={busy}>
            {busy && <Spinner animation="border" size="sm" className="me-1" />}
            บันทึก
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default IssueDateMasterPage;
