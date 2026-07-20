import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';

// Numpad บันทึกยอด OK/NG — port จาก NumpadDialog (shop_floor_screen.dart L1810-2298)
const NG_MODES = ['DAMAGE', 'DIMENSION NG', 'DIS-COLOR', 'SCREW NG', 'MATERIAL NG', 'TOOLING NG', 'OTHER'];
const CLOSE_REASONS = [
  'หาของไม่เจอ / ชิ้นงานสูญหาย',
  'Step ก่อนหน้านับยอด/คีย์ข้อมูลผิด',
  'QA ดึงงานไปตรวจสอบ (Sample Test)',
  'หัวหน้างาน / Planner สั่งตัดจบงาน',
  'อื่นๆ',
];
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'DEL'];

// cap = ยอดสูงสุดที่ใส่ได้ครั้งนี้ (parent คำนวณจาก waterfall + ยอดเดิมตอน edit แล้ว)
const NumpadDialog = ({ show, stepName, machine, cap, editRecord, onSubmit, onHide }) => {
  const [okStr, setOkStr] = useState('0');
  const [ngStr, setNgStr] = useState('0');
  const [activeField, setActiveField] = useState('ok');
  const [ngMode, setNgMode] = useState('');
  const [forceClose, setForceClose] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [alertMsg, setAlertMsg] = useState('');

  useEffect(() => {
    if (!show) return;
    setOkStr(String(editRecord?.qtyOK ?? 0));
    setNgStr(String(editRecord?.qtyNG ?? 0));
    setNgMode(editRecord?.modeNG && editRecord.modeNG !== '-' ? editRecord.modeNG : '');
    setActiveField('ok');
    setForceClose(false);
    setCloseReason('');
    setAlertMsg('');
  }, [show, editRecord]);

  const onKeyPress = (k) => {
    const [val, setVal] = activeField === 'ok' ? [okStr, setOkStr] : [ngStr, setNgStr];
    if (k === 'C') setVal('0');
    else if (k === 'DEL') setVal(val.length > 1 ? val.slice(0, -1) : '0');
    else setVal(val === '0' ? k : val + k);
  };

  const handleSave = () => {
    const ok = parseInt(okStr, 10) || 0;
    const ng = parseInt(ngStr, 10) || 0;
    // validation 4 ข้อ ลำดับตามเดิม (dart L2232-2278)
    if (ok === 0 && ng === 0 && !forceClose) {
      setAlertMsg(
        'กรุณาระบุจำนวน QTY OK หรือ QTY NG อย่างน้อย 1 ช่องครับ\n(หรือติ๊กบังคับจบงานถ้าของหมดแล้ว)'
      );
      return;
    }
    if (ng > 0 && !ngMode) {
      setAlertMsg("มีงานเสีย (NG) กรุณาเลือก 'สาเหตุ NG' ด้วยครับ!");
      return;
    }
    if (ok + ng > cap) {
      setAlertMsg(`จำนวนรวมเกินกว่าที่ทำได้!\nคุณสามารถใส่ได้สูงสุดแค่ ${cap} ชิ้น`);
      return;
    }
    if (forceClose && !closeReason) {
      setAlertMsg("กรุณาระบุ 'เหตุผลที่ยอดไม่ครบ' ด้วยครับ!");
      return;
    }
    onSubmit(ok, ng, ng > 0 ? ngMode : null, forceClose, closeReason);
  };

  const fieldStyle = (field, color) => ({
    border: `2px solid ${activeField === field ? color : '#ced4da'}`,
    borderRadius: 8,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '1.4rem',
    fontWeight: 'bold',
    color,
    textAlign: 'center',
    backgroundColor: activeField === field ? `${color}14` : '#fff',
  });

  return (
    <Modal show={show} onHide={onHide} backdrop="static" keyboard={false} centered>
      <Modal.Header>
        <Modal.Title style={{ fontSize: '1.05rem' }}>
          บันทึกยอดผลิต: {stepName} ({machine})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="warning" className="py-2 small">
          ⚠️ ยอดที่บันทึกได้สูงสุดครั้งนี้: {cap} ชิ้น
        </Alert>

        <div className="d-flex gap-3 mb-3">
          <div className="flex-fill" onClick={() => setActiveField('ok')}>
            <div className="small fw-bold" style={{ color: '#2e7d32' }}>
              QTY OK
            </div>
            <div style={fieldStyle('ok', '#2e7d32')}>{okStr}</div>
          </div>
          <div className="flex-fill" onClick={() => setActiveField('ng')}>
            <div className="small fw-bold" style={{ color: '#c62828' }}>
              QTY NG
            </div>
            <div style={fieldStyle('ng', '#c62828')}>{ngStr}</div>
          </div>
        </div>

        {(activeField === 'ng' || (parseInt(ngStr, 10) || 0) > 0) && (
          <Form.Group className="mb-3">
            <Form.Label className="small fw-bold">สาเหตุ NG</Form.Label>
            <Form.Select value={ngMode} onChange={(e) => setNgMode(e.target.value)}>
              <option value="">-- เลือกสาเหตุ --</option>
              {NG_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        )}

        <div className="border rounded p-2 mb-3">
          <Form.Check
            type="checkbox"
            id="force-close-check"
            label="✅ ชิ้นงานหมดตะกร้า (บังคับจบงาน)"
            checked={forceClose}
            onChange={(e) => setForceClose(e.target.checked)}
          />
          <div className="small text-muted ms-4">ติ๊กเมื่อของหมดแล้ว แต่ยอดรวมไม่ถึงแผน</div>
          {forceClose && (
            <Form.Group className="mt-2">
              <Form.Label className="small fw-bold">เหตุผลที่ยอดไม่ครบ</Form.Label>
              <Form.Select value={closeReason} onChange={(e) => setCloseReason(e.target.value)}>
                <option value="">-- เลือกเหตุผล --</option>
                {CLOSE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}
        </div>

        <div className="d-grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {KEYS.map((k) => (
            <Button
              key={k}
              variant={k === 'C' || k === 'DEL' ? 'outline-secondary' : 'outline-dark'}
              style={{ height: 52, fontSize: '1.2rem', fontWeight: 'bold' }}
              onClick={() => onKeyPress(k)}
            >
              {k}
            </Button>
          ))}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ยกเลิก
        </Button>
        <Button variant="success" onClick={handleSave}>
          บันทึกข้อมูล
        </Button>
      </Modal.Footer>

      {/* AlertDialog "แจ้งเตือน" ซ้อนบน numpad (ตามเดิม) */}
      <Modal show={!!alertMsg} onHide={() => setAlertMsg('')} centered backdrop="static">
        <Modal.Header>
          <Modal.Title style={{ fontSize: '1rem' }}>แจ้งเตือน</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ whiteSpace: 'pre-line' }}>{alertMsg}</Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setAlertMsg('')}>
            ตกลง
          </Button>
        </Modal.Footer>
      </Modal>
    </Modal>
  );
};

export default NumpadDialog;
