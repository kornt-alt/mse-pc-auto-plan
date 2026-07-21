import React, { useState, useCallback } from 'react';
import {
  Card,
  Button,
  Form,
  Table,
  Toast,
  ToastContainer,
  Modal,
  Spinner,
  InputGroup,
  Badge,
} from 'react-bootstrap';
import { QrCode, Info, FileText, ListOrdered } from 'lucide-react';
import { apiCall } from '../../api/client';
import useScanInput from '../../components/shared/useScanInput';
import MachineQueuePanel from './MachineQueuePanel';
import NumpadDialog from './NumpadDialog';
import RecordHistoryDialog from './RecordHistoryDialog';
import DrawingViewerDialog from './DrawingViewerDialog';

// Shop Floor Control — port จาก ShopFloorScreen (shop_floor_screen.dart L12-1794)
// 2 โหมดในหน้าเดียว: LOGIN (สแกนรหัสพนักงาน 5 ตัว — ไม่ใช่ app auth) กับ SHOP FLOOR
const SHIFTS = ['A', 'B', 'C', 'M', 'N'];

// วันที่โรงงานฝั่ง client: ก่อน 07:00 นับเป็นวันก่อนหน้า (dart L59-68)
const calcWorkingDate = () => {
  const now = new Date();
  if (now.getHours() < 7) now.setDate(now.getDate() - 1);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

const ShopFloorPage = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [empCode, setEmpCode] = useState('');
  const [shift, setShift] = useState('A'); // default A ไม่ auto-detect (ตามเดิม)
  const [workingDate] = useState(calcWorkingDate);

  const [batchId, setBatchId] = useState('');
  const [trackingData, setTrackingData] = useState([]);
  const [orderModel, setOrderModel] = useState('');
  const [orderQty, setOrderQty] = useState(0);
  const [orderDesc, setOrderDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const [numpadCtx, setNumpadCtx] = useState(null); // {stepData, cap, editRecord}
  const [historyStep, setHistoryStep] = useState(null); // processStep ที่เปิดประวัติ
  const [queueMachine, setQueueMachine] = useState(null); // เครื่องที่เปิด queue popup
  const [showDrawing, setShowDrawing] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, variant = 'success') => {
    setToast({ message, variant });
  }, []);
  const showError = useCallback(
    (message) => showToast(`❌ ${message}`, 'danger'),
    [showToast]
  );

  const clearData = useCallback(() => {
    setTrackingData([]);
    setOrderModel('');
    setOrderQty(0);
    setOrderDesc('');
  }, []);

  // ===== operator login (ไม่มี API — แค่เก็บรหัสไว้ส่งตอนบันทึก ตามเดิม) =====
  const empScan = useScanInput(5, (code) => doLogin(code));

  function doLogin(code) {
    const c = (code ?? empScan.value).trim();
    if (!c) {
      showError('กรุณาสแกนหรือพิมพ์รหัสพนักงานก่อนครับ!');
      return;
    }
    setEmpCode(c);
    setIsLoggedIn(true);
  }

  const doLogout = () => {
    // ปุ่ม "จบงาน" — ออกจากโหมดงาน กลับไปหน้าสแกน (ไม่ใช่ logout ระบบ)
    setIsLoggedIn(false);
    setEmpCode('');
    empScan.reset();
    batchScan.reset();
    setBatchId('');
    clearData();
  };

  // ===== batch scan + tracking =====
  const fetchTracking = useCallback(
    async (batch) => {
      const b = String(batch ?? '').trim();
      if (!b) return;
      setLoading(true);
      setBatchId(b);
      try {
        const res = await apiCall(`/production/tracking/${encodeURIComponent(b)}`);
        if (res.found === false) {
          showError(`ไม่พบแผนการผลิตของ Batch: ${b}`);
          setTrackingData([]);
          return;
        }
        setTrackingData(res.data || []);
        setOrderModel(res.model || '');
        setOrderQty(res.qty || 0);
        setOrderDesc(res.description || '');
      } catch (err) {
        showError(err.message);
        setTrackingData([]);
      } finally {
        setLoading(false);
      }
    },
    [showError]
  );

  const batchScan = useScanInput(10, fetchTracking, () => clearData());

  // ===== waterfall cap ฝั่ง client (dart L1503-1523) =====
  // step แรก = qty ของ order / step ถัดไป = qtyOK ของ step ก่อนหน้า
  const maxAllowedTotal = (idx) =>
    idx === 0 ? orderQty : trackingData[idx - 1]?.qtyOK ?? 0;

  const openNumpad = (idx, editRecord = null) => {
    const row = trackingData[idx];
    const accumulated = (row.qtyOK ?? 0) + (row.qtyNG ?? 0);
    const oldTotal = editRecord ? (editRecord.qtyOK ?? 0) + (editRecord.qtyNG ?? 0) : 0;
    // cap ต่อครั้ง (dart L1889-1893) — ตอน edit บวกยอดเดิมคืน
    const cap = Math.max(0, maxAllowedTotal(idx) - accumulated + oldTotal);
    setNumpadCtx({ stepData: row, cap, editRecord });
  };

  // ===== บันทึก / แก้ไข / ลบ / force-close =====
  const handleNumpadSubmit = useCallback(
    async (ok, ng, ngMode, isForceClosed, closeReason) => {
      const { stepData, editRecord } = numpadCtx;
      setNumpadCtx(null);
      try {
        if (editRecord) {
          await apiCall(`/production/record/${editRecord.id}`, {
            method: 'PUT',
            body: JSON.stringify({ qty_ok: ok, qty_ng: ng, mode_ng: ngMode }),
          });
          showToast('✅ แก้ไขข้อมูลสำเร็จ!');
        } else {
          await apiCall('/production/record', {
            method: 'POST',
            body: JSON.stringify({
              employee: empCode,
              batch: batchId,
              process_step: stepData.processStep,
              machine: stepData.machine,
              qty_ok: ok,
              qty_ng: ng,
              mode_ng: ngMode,
              working_date: workingDate,
              working_shift: shift,
            }),
          });
          showToast('✅ บันทึกยอดสำเร็จ!');
        }
        if (isForceClosed) {
          await apiCall('/production/force-close', {
            method: 'POST',
            body: JSON.stringify({
              batch: batchId,
              step: stepData.processStep,
              machine: stepData.machine,
              reason: closeReason,
              employee: empCode, // FIX: ส่งรหัสพนักงานให้ backend บันทึก closed_by
            }),
          });
          showToast('✅ บังคับปิดจ๊อบสำเร็จ!');
        }
      } catch (err) {
        showError(editRecord ? 'แก้ไขไม่สำเร็จ!' : err.message || 'บันทึกไม่สำเร็จ!');
      }
      fetchTracking(batchId);
    },
    [numpadCtx, empCode, batchId, workingDate, shift, fetchTracking, showToast, showError]
  );

  const handleDeleteRecord = useCallback(
    async (record) => {
      try {
        await apiCall(`/production/record/${record.id}`, { method: 'DELETE' });
        showToast('🗑️ ลบข้อมูลสำเร็จ!', 'warning');
      } catch {
        showError('ลบข้อมูลไม่สำเร็จ!');
      }
      fetchTracking(batchId);
    },
    [batchId, fetchTracking, showToast, showError]
  );

  const handleEditFromHistory = useCallback(
    (record) => {
      const idx = trackingData.findIndex((r) => r.processStep === historyStep);
      setHistoryStep(null);
      if (idx >= 0) openNumpad(idx, record);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackingData, historyStep]
  );

  const historyRow = trackingData.find((r) => r.processStep === historyStep);

  // ========== โหมด LOGIN ==========
  if (!isLoggedIn) {
    return (
      <div className="container-fluid py-3">
        <h5 className="text-mse fw-bold text-center mb-3">LOG IN</h5>
        <Card className="shadow-sm mb-3">
          <Card.Body>
            <div className="row g-3 align-items-end">
              <div className="col-md-3">
                <Form.Label className="fw-bold small">รหัสพนักงาน (สแกน/พิมพ์)</Form.Label>
                <InputGroup>
                  <InputGroup.Text>
                    <QrCode size={16} />
                  </InputGroup.Text>
                  <Form.Control
                    type="password"
                    value={empScan.value}
                    onChange={empScan.onChange}
                    onKeyDown={empScan.onKeyDown}
                    placeholder="รหัสพนักงาน 5 ตัว"
                    autoFocus
                  />
                </InputGroup>
              </div>
              <div className="col-md-4">
                <Form.Label className="fw-bold small">เลือกกะ:</Form.Label>
                <div className="d-flex gap-2">
                  {SHIFTS.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={shift === s ? 'primary' : 'outline-primary'}
                      style={shift === s ? { backgroundColor: '#1565c0' } : {}}
                      onClick={() => setShift(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="col-md-2">
                <Button className="w-100 btn-mse" onClick={() => doLogin()}>
                  LOG IN
                </Button>
              </div>
              <div className="col-md-3">
                <div className="border rounded p-2 text-center bg-light">
                  <div className="small text-muted">Working Date</div>
                  <div className="fw-bold">{workingDate}</div>
                </div>
              </div>
            </div>
          </Card.Body>
        </Card>

        {/* Machine Queue dashboard โชว์ก่อน login (ตามเดิม สูง 500) */}
        <Card className="shadow-sm">
          <Card.Body>
            <MachineQueuePanel embedded height={500} />
          </Card.Body>
        </Card>
      </div>
    );
  }

  // ========== โหมด SHOP FLOOR ==========
  return (
    <div className="container-fluid py-3">
      <div
        className="d-flex flex-wrap align-items-center gap-2 px-3 py-2 mb-3 rounded text-white"
        style={{ backgroundColor: '#1565c0' }}
      >
        <strong>SHOP FLOOR</strong>
        <Badge bg="light" text="dark">
          Emp: {empCode}
        </Badge>
        <Badge bg="light" text="dark">
          Shift: {shift}
        </Badge>
        <Badge bg="light" text="dark">
          Date: {workingDate}
        </Badge>
        <div className="ms-auto">
          <Button variant="success" size="sm" onClick={doLogout}>
            จบงาน
          </Button>
        </div>
      </div>

      <Card className="shadow-sm mb-3">
        <Card.Body>
          <div className="d-flex gap-2 align-items-center">
            <InputGroup style={{ maxWidth: 360 }}>
              <InputGroup.Text>
                <QrCode size={16} />
              </InputGroup.Text>
              <Form.Control
                value={batchScan.value}
                onChange={batchScan.onChange}
                onKeyDown={batchScan.onKeyDown}
                placeholder="สแกน Batch Barcode"
                autoFocus
              />
            </InputGroup>
            <Button variant="success" onClick={() => fetchTracking(batchScan.value)}>
              ค้นหา
            </Button>
            {loading && <Spinner animation="border" size="sm" />}
          </div>
        </Card.Body>
      </Card>

      {trackingData.length === 0 ? (
        <div className="text-center text-muted py-5">
          <QrCode size={64} className="mb-3" />
          <div>กรุณาสแกน Batch Barcode เพื่อเริ่มงาน</div>
        </div>
      ) : (
        <>
          <div
            className="d-flex flex-wrap align-items-center gap-3 px-3 py-2 rounded"
            style={{ backgroundColor: '#ff9800', color: '#fff' }}
          >
            <strong>Batch No: {batchId}</strong>
            <Button
              variant="outline-light"
              size="sm"
              onClick={() => setShowDrawing(true)}
              disabled={!orderModel}
            >
              <FileText size={14} className="me-1" />
              Dwg
            </Button>
            <span>
              Model: {orderModel} {orderDesc}
            </span>
            <span className="ms-auto fw-bold">Qty: {orderQty}</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <Table bordered hover className="mt-2 bg-white">
              <thead className="table-secondary">
                <tr>
                  <th>Process Step</th>
                  <th>Machine</th>
                  <th>Qty OK</th>
                  <th>Qty NG</th>
                  <th>Last Record</th>
                </tr>
              </thead>
              <tbody>
                {trackingData.map((row, idx) => {
                  const hasData = row.qtyOK !== null && row.qtyOK !== undefined;
                  return (
                    <tr
                      key={`${row.processStep}-${idx}`}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: hasData ? '#e8f5e9' : '#fff',
                      }}
                      onClick={() => openNumpad(idx)}
                    >
                      <td className="fw-bold">{row.processStep}</td>
                      <td>
                        {row.machine}
                        {row.machine && row.machine !== 'Finished' && (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 ms-2"
                            title={`ดูคิวงานของเครื่อง ${row.machine}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setQueueMachine(row.machine);
                            }}
                          >
                            <ListOrdered size={15} />
                          </Button>
                        )}
                      </td>
                      <td className="text-end fw-bold" style={{ color: '#2e7d32' }}>
                        {row.qtyOK ?? '-'}
                      </td>
                      <td className="text-end fw-bold" style={{ color: '#c62828' }}>
                        {row.qtyNG ?? '-'}
                      </td>
                      <td>
                        {row.lastRecord}
                        {row.history && row.history.length > 0 && (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 ms-2"
                            title="ดูประวัติการบันทึก"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryStep(row.processStep);
                            }}
                          >
                            <Info size={15} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {/* Numpad บันทึกยอด */}
      <NumpadDialog
        show={!!numpadCtx}
        stepName={numpadCtx?.stepData?.processStep ?? ''}
        machine={numpadCtx?.stepData?.machine ?? ''}
        cap={numpadCtx?.cap ?? 0}
        editRecord={numpadCtx?.editRecord ?? null}
        onSubmit={handleNumpadSubmit}
        onHide={() => setNumpadCtx(null)}
      />

      {/* ประวัติการบันทึกของ step */}
      <RecordHistoryDialog
        show={!!historyRow}
        stepName={historyStep ?? ''}
        history={historyRow?.history ?? []}
        empCode={empCode}
        onEdit={handleEditFromHistory}
        onDelete={handleDeleteRecord}
        onHide={() => setHistoryStep(null)}
      />

      {/* คิวงานของเครื่อง (popup) */}
      <Modal show={!!queueMachine} onHide={() => setQueueMachine(null)} size="xl">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.05rem' }}>
            Production Plan for {queueMachine}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {queueMachine && (
            <MachineQueuePanel fixedMachine={queueMachine} highlightBatch={batchId} />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setQueueMachine(null)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      <DrawingViewerDialog
        show={showDrawing}
        model={orderModel}
        onHide={() => setShowDrawing(false)}
      />

      <ToastContainer position="bottom-end" className="p-3" style={{ zIndex: 2000 }}>
        <Toast
          show={!!toast}
          onClose={() => setToast(null)}
          delay={3500}
          autohide
          bg={toast?.variant === 'danger' ? 'danger' : toast?.variant === 'warning' ? 'warning' : 'success'}
        >
          <Toast.Body className={toast?.variant === 'warning' ? '' : 'text-white'}>
            {toast?.message}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </div>
  );
};

export default ShopFloorPage;
