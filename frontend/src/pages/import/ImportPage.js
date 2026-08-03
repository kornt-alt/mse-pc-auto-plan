// Import Data — อัปโหลดไฟล์ CSV/Excel จากเครื่องผู้ใช้เข้าฐานข้อมูล
//   (แทน Tkinter upload_menu.py เดิมที่ยิง API ไม่มี auth — user เลือกย้ายมาหน้าเว็บ + JWT ADMIN/PLANNER, 2026-07-17)
//   2026-08-03: ดาวน์โหลด master template (.xlsx) + คำแนะนำ, รองรับ .xlsx,
//   และ preview ก่อนบันทึก + confirm modal (เตือนสีแดงเมื่อแทนที่ทั้งตาราง) + dedup กันข้อมูลเบิ่ล
//   + ตัวช่วยสร้าง template อัตโนมัติ (ปุ่ม bi-magic): Calendar (machine×date),
//     Machine/Routing (wizard โครง flow/step), Actual Result (ดึง step/machine ตามแผนจริง)
import React, { useState, useEffect } from 'react';
import { Container, Card, Button, Form, Spinner, Modal, Table } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import ConfirmModal from '../../components/shared/ConfirmModal';
import { TEMPLATE_SPECS, downloadTemplate, exampleRow } from '../../utils/importTemplates';
import CalendarTemplateDialog from './CalendarTemplateDialog';
import ConfigTemplateDialog from './ConfigTemplateDialog';
import ActualResultTemplateDialog from './ActualResultTemplateDialog';

// mode: 'append' (เพิ่มต่อท้าย) | 'replace' (ลบทั้งตารางแล้วใส่ใหม่ — destructive) | 'upsert'
// builder: ตัวช่วยสร้าง template อัจฉริยะ (เติมโครง/ดึงข้อมูลจริงให้) — orders/product_master ใช้หัวตารางเปล่าพอ
const UPLOAD_ROWS = [
  { endpoint: '/upload/orders', label: 'Orders', note: 'เพิ่มเฉพาะ batch ใหม่ (append-only)', template: 'orders', mode: 'append' },
  { endpoint: '/upload/calendar', label: 'Calendar', note: 'อัปเดต/เพิ่มเฉพาะ Machine+Date ในไฟล์', template: 'calendar', mode: 'upsert', builder: 'calendar' },
  { endpoint: '/upload/machines', label: 'Machine Config', note: 'แทนที่เฉพาะ Model ที่อยู่ในไฟล์ (Model อื่นไม่หาย)', template: 'machines', mode: 'replace_models', builder: 'machines' },
  { endpoint: '/upload/routing', label: 'Routing', note: 'แทนที่เฉพาะ Model ที่อยู่ในไฟล์ (Model อื่นไม่หาย)', template: 'routing', mode: 'replace_models', builder: 'routing' },
  {
    endpoint: '/upload/actual_result',
    label: 'Actual Result',
    note: 'ตรวจ (batch, step, machine) กับแผนก่อนบันทึก',
    template: 'actual_result',
    mode: 'append',
    builder: 'actual_result',
  },
  {
    endpoint: '/product-master/upload-csv',
    label: 'Product Master (upsert)',
    note: 'เพิ่ม/อัปเดตรายตัวตาม model',
    template: 'product_master',
    mode: 'upsert',
  },
  {
    endpoint: '/upload/product_master',
    label: 'Product Master (แทนที่)',
    note: 'แทนที่ทั้งตาราง (อันตราย)',
    template: 'product_master',
    mode: 'replace',
  },
];

// แถวสรุปตัวเลข preview — โชว์เฉพาะ field ที่มีค่า (undefined = ไม่เกี่ยวกับ endpoint นี้)
const PREVIEW_FIELDS = [
  { key: 'total', label: 'แถวในไฟล์', color: '' },
  { key: 'to_insert', label: 'จะเพิ่ม', color: 'text-success' },
  { key: 'to_update', label: 'จะอัปเดต', color: 'text-primary' },
  { key: 'skipped_existing', label: 'ข้าม (มีในระบบแล้ว)', color: 'text-muted' },
  { key: 'already_in_db', label: 'ข้าม (อัปซ้ำกับฐานข้อมูล)', color: 'text-muted' },
  { key: 'duplicates_in_file', label: 'ตัดแถวซ้ำในไฟล์', color: 'text-muted' },
  { key: 'rejected', label: 'ปัดตก (ไม่ตรงแผน)', color: 'text-danger' },
  // batch ซ้ำในไฟล์แต่ค่าต่าง — ยังถูกเพิ่มทั้งคู่ (policy exact-row) โชว์เฉพาะเมื่อพบ เพื่อเตือน
  { key: 'same_batch_conflict', label: '⚠ batch ซ้ำในไฟล์ (ค่าต่างกัน)', color: 'text-danger', onlyIfPositive: true },
];

const ImportPreviewSummary = ({ preview }) => {
  if (!preview) return null;
  const isReplace = preview.mode === 'replace';
  const isReplaceModels = preview.mode === 'replace_models';

  return (
    <div>
      {isReplace && (
        <div className="alert alert-danger py-2 mb-3" role="alert">
          <i className="bi bi-exclamation-octagon-fill me-2" aria-hidden="true" />
          จะ<strong>ลบข้อมูลเดิมทั้งหมด {preview.delete_existing ?? 0} แถว</strong> แล้วแทนที่ด้วย{' '}
          <strong>{preview.to_insert ?? 0} แถว</strong>
        </div>
      )}
      {isReplaceModels && (
        <div className="alert alert-warning py-2 mb-3" role="alert">
          <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
          จะลบข้อมูลเดิม <strong>{preview.delete_existing ?? 0} แถว</strong> (เฉพาะ {preview.models_affected ?? 0} Model ที่พบในไฟล์) แล้วใส่ข้อมูลอัปเดต <strong>{preview.to_insert ?? 0} แถว</strong>
        </div>
      )}
      <Table size="sm" borderless className="mb-0">
        <tbody>
          {PREVIEW_FIELDS.filter(
            (f) => preview[f.key] !== undefined && (!f.onlyIfPositive || preview[f.key] > 0)
          ).map((f) => (
            <tr key={f.key}>
              <td className="text-muted">{f.label}</td>
              <td className={`num text-end fw-semibold ${f.color}`}>
                {Number(preview[f.key]).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

// แถวอัปโหลด 1 ไฟล์ — เลือกไฟล์แล้วกดอัปโหลด (form field "file") + ปุ่ม template/คำแนะนำ
// resetToken: parent เพิ่มค่าเมื่ออัปโหลดจริงสำเร็จ → ล้าง file input (ConfirmModal ปิดก่อนเรียก onConfirm
// จึงคืน bool ตรง ๆ ไม่ได้)
const UploadRow = ({ row, busy, onUpload, onInfo, onBuild, resetToken }) => {
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0); // เปลี่ยน key เพื่อล้าง file input
  const spec = TEMPLATE_SPECS[row.template];

  useEffect(() => {
    if (resetToken > 0) {
      setFile(null);
      setInputKey((k) => k + 1);
    }
  }, [resetToken]);

  return (
    <tr>
      <td className="fw-semibold">{row.label}</td>
      <td className="text-muted small">{row.note}</td>
      <td>
        <div className="d-flex gap-1">
          {row.builder && (
            <Button
              size="sm"
              variant="outline-primary"
              disabled={busy}
              onClick={() => onBuild(row)}
              title="สร้าง Template อัตโนมัติ (เติมโครง/ดึงข้อมูลจริง)"
              aria-label={`สร้าง Template อัตโนมัติ ${row.label}`}
            >
              <i className="bi bi-magic" aria-hidden="true" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline-success"
            disabled={busy || !spec}
            onClick={() => spec && downloadTemplate(spec)}
            title="ดาวน์โหลด Template เปล่า (หัวตารางอย่างเดียว)"
            aria-label={`ดาวน์โหลด Template ${row.label}`}
          >
            <i className="bi bi-file-earmark-excel" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            disabled={!spec}
            onClick={() => spec && onInfo(spec)}
            title="คำแนะนำ / ตัวอย่างการกรอก"
            aria-label={`คำแนะนำ ${row.label}`}
          >
            <i className="bi bi-info-circle" aria-hidden="true" />
          </Button>
        </div>
      </td>
      <td>
        <Form.Control
          key={inputKey}
          type="file"
          accept=".csv,.xlsx"
          size="sm"
          disabled={busy}
          onChange={(e) => setFile(e.target.files[0] ?? null)}
        />
      </td>
      <td>
        <Button size="sm" className="btn-mse" disabled={busy || !file} onClick={() => onUpload(row, file)}>
          <i className="bi bi-upload me-1" aria-hidden="true" />
          ตรวจสอบ
        </Button>
      </td>
    </tr>
  );
};

// Modal คำแนะนำวิธีกรอก + ตัวอย่างข้อมูล (แสดงบนเว็บ ไม่ฝังในไฟล์ template)
const TemplateInfoModal = ({ spec, onHide }) => {
  if (!spec) return null;
  const example = exampleRow(spec);
  return (
    <Modal show={!!spec} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          <i className="bi bi-info-circle me-2" aria-hidden="true" />
          วิธีกรอกข้อมูล — {spec.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {spec.note && (
          <div className="alert alert-warning py-2 small" role="note">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            {spec.note}
          </div>
        )}
        <p className="text-muted small mb-2">
          หัวคอลัมน์ต้องสะกดตรงตามนี้ (ตัวพิมพ์เล็ก/ใหญ่ต้องตรง) — ช่องที่ไม่จำเป็นเว้นว่างได้
        </p>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <Table bordered size="sm" className="align-middle mb-3">
            <thead className="table-light">
              <tr>
                <th>คอลัมน์</th>
                <th>จำเป็น</th>
                <th>รูปแบบ</th>
                <th>ค่า default</th>
                <th>ตัวอย่าง</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {spec.columns.map((c) => (
                <tr key={c.name}>
                  <td className="num fw-semibold">{c.name}</td>
                  <td>
                    {c.required ? (
                      <span className="badge bg-danger">จำเป็น</span>
                    ) : (
                      <span className="text-muted small">ไม่บังคับ</span>
                    )}
                  </td>
                  <td className="small">{c.format || '-'}</td>
                  <td className="small">{c.default ?? '-'}</td>
                  <td className="small">{c.example || '-'}</td>
                  <td className="text-muted small">{c.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <p className="fw-semibold small mb-1">ตัวอย่างแถวข้อมูล</p>
        <div style={{ overflowX: 'auto' }}>
          <Table bordered size="sm" className="align-middle mb-0">
            <thead className="table-light">
              <tr>
                {example.map((c) => (
                  <th key={c.name} className="num small">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {example.map((c) => (
                  <td key={c.name} className="small">{c.value || <span className="text-muted">(ว่าง)</span>}</td>
                ))}
              </tr>
            </tbody>
          </Table>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-success" onClick={() => downloadTemplate(spec)}>
          <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
          ดาวน์โหลด Template
        </Button>
        <Button variant="secondary" onClick={onHide}>
          ปิด
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

const ImportPage = () => {
  // {type: 'idle'|'busy'|'ok'|'error', message}
  const [status, setStatus] = useState({ type: 'idle', message: 'พร้อมทำงาน' });
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(null); // rejected_records จาก /upload/actual_result
  const [infoSpec, setInfoSpec] = useState(null); // spec ที่กำลังเปิด Modal คำแนะนำ
  const [confirm, setConfirm] = useState(null); // object ให้ ConfirmModal (preview + ยืนยัน)
  const [builder, setBuilder] = useState(null); // 'calendar'|'machines'|'routing'|'actual_result' ที่กำลังเปิด
  const [resetTokens, setResetTokens] = useState({}); // endpoint → token (เพิ่มเมื่ออัปสำเร็จ เพื่อล้าง input)

  const isError = status.type === 'error';

  const postFile = (row, file, dryRun) => {
    const fd = new FormData();
    fd.append('file', file);
    if (row.mode) fd.append('mode', row.mode); // ✨ เพิ่มบรรทัดนี้ เพื่อส่ง mode ให้ Backend
    if (dryRun) fd.append('dry_run', '1');
    return apiCall(row.endpoint, { method: 'POST', body: fd });
  };

  // เขียนจริง (หลังผู้ใช้ยืนยันใน ConfirmModal)
  const runRealUpload = async (row, file) => {
    setBusy(true);
    setStatus({ type: 'busy', message: `กำลังอัปโหลด ${row.label}...` });
    try {
      const data = await postFile(row, file, false);
      if (data.status === 'error') {
        setStatus({ type: 'error', message: data.message });
        return;
      }
      setStatus({ type: 'ok', message: data.message || `อัปโหลด ${row.label} สำเร็จ` });
      if (data.rejected_records && data.rejected_records.length > 0) {
        setRejected(data.rejected_records);
      }
      setResetTokens((t) => ({ ...t, [row.endpoint]: (t[row.endpoint] || 0) + 1 }));
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  // step 1: dry-run ขอ preview แล้วเปิด ConfirmModal
  const handleUpload = async (row, file) => {
    setBusy(true);
    setStatus({ type: 'busy', message: `กำลังตรวจสอบ ${row.label}...` });
    try {
      const data = await postFile(row, file, true);
      // product-master upsert คืน status:'error' เมื่อคอลัมน์ไม่ครบ (พฤติกรรมเดิม)
      if (data.status === 'error') {
        setStatus({ type: 'error', message: data.message });
        return;
      }
      const preview = data.preview || {};
      setStatus({ type: 'idle', message: 'ตรวจสอบไฟล์เสร็จ — โปรดยืนยัน' });
      setConfirm({
        title: `ยืนยันการอัปโหลด — ${row.label}`,
        body: <ImportPreviewSummary preview={preview} />,
        confirmLabel: row.mode === 'replace' ? 'ลบและแทนที่' : row.mode === 'replace_models' ? 'ยืนยันอัปเดต Model' : 'ยืนยันอัปโหลด',
        variant: row.mode === 'replace' ? 'danger' : row.mode === 'replace_models' ? 'warning' : 'primary',
        onConfirm: () => runRealUpload(row, file),
      });
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container className="pb-4" style={{ maxWidth: 900 }}>
      <PageHeader
        icon="bi-database-up"
        title="Import Data"
        subtitle="นำข้อมูลจากไฟล์ CSV / Excel เข้าสู่ฐานข้อมูล"
      />

      {/* status box */}
      <div
        className={`border rounded p-3 mb-4 text-center fw-bold ${
          isError ? 'text-danger border-danger-subtle' : 'text-success'
        }`}
        style={{ background: 'var(--mse-surface)' }}
        role="status"
      >
        {busy ? (
          <Spinner size="sm" animation="border" className="me-2" />
        ) : (
          <i
            className={`bi ${isError ? 'bi-x-circle-fill' : status.type === 'ok' ? 'bi-check-circle-fill' : 'bi-info-circle'} me-2`}
            aria-hidden="true"
          />
        )}
        {status.message}
      </div>

      {/* อัปโหลดไฟล์จากเครื่อง */}
      <Card>
        <Card.Header className="fw-bold d-flex align-items-center justify-content-between">
          <span>
            <i className="bi bi-file-earmark-arrow-up me-2" aria-hidden="true" />
            อัปโหลดไฟล์จากเครื่อง (CSV / Excel)
          </span>
          <span className="text-muted small fw-normal">
            <i className="bi bi-download me-1" aria-hidden="true" />
            ดาวน์โหลด Template แล้วกรอกข้อมูลก่อนอัปโหลด
          </span>
        </Card.Header>
        <Card.Body>
          <Table size="sm" borderless className="align-middle mb-0">
            <thead>
              <tr className="text-muted small">
                <th>ข้อมูล</th>
                <th>รายละเอียด</th>
                <th>Template / คำแนะนำ</th>
                <th>ไฟล์</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {UPLOAD_ROWS.map((row) => (
                <UploadRow
                  key={row.endpoint}
                  row={row}
                  busy={busy || !!confirm}
                  onUpload={handleUpload}
                  onInfo={setInfoSpec}
                  onBuild={(r) => setBuilder(r.builder)}
                  resetToken={resetTokens[row.endpoint] || 0}
                />
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* Modal คำแนะนำวิธีกรอก */}
      <TemplateInfoModal spec={infoSpec} onHide={() => setInfoSpec(null)} />

      {/* ===== ตัวช่วยสร้าง Template อัตโนมัติ ===== */}
      <CalendarTemplateDialog show={builder === 'calendar'} onHide={() => setBuilder(null)} />
      <ConfigTemplateDialog
        show={builder === 'machines'}
        specKey="machines"
        withAlternatives
        onHide={() => setBuilder(null)}
      />
      <ConfigTemplateDialog
        show={builder === 'routing'}
        specKey="routing"
        withAlternatives={false}
        onHide={() => setBuilder(null)}
      />
      <ActualResultTemplateDialog show={builder === 'actual_result'} onHide={() => setBuilder(null)} />

      {/* Modal preview + ยืนยัน (แทนที่ทั้งตาราง = variant danger) */}
      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />

      {/* ===== dialog รายการที่ถูกปัดตกจาก actual_result ===== */}
      <Modal show={!!rejected} onHide={() => setRejected(null)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            รายการที่ไม่ตรงกับแผน (ไม่ได้บันทึก)
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            รายการต่อไปนี้ไม่พบ (batch, step, machine) ใน schedule_results จึงไม่ถูกบันทึก
          </p>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <Table bordered size="sm">
              <thead className="table-light">
                <tr>
                  <th>Batch</th>
                  <th>Process Step</th>
                  <th>Machine</th>
                </tr>
              </thead>
              <tbody>
                {(rejected ?? []).map((r, i) => (
                  <tr key={i}>
                    <td>{r.batch}</td>
                    <td>{r.process_step}</td>
                    <td>{r.machine}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRejected(null)}>
            ปิด
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default ImportPage;