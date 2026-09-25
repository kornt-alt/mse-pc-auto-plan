// ตัวเลือกเครื่อง + Batch ของแท็บ Schedule / Dispatch (แทน FilterBar เดิม)
// ค่าว่าง = ทุกเครื่อง / ทุก batch · เลือก batch = โชว์ทั้งกลุ่ม parent (กฎเดิม — filterPlanRows)
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';

const MachineBatchFilter = ({ id, machines, batches, machine, batch, onChange }) => {
  // ข้อความที่กำลังพิมพ์แยกจาก filter จริง — filter เปลี่ยนเมื่อพิมพ์ตรงรหัส batch หรือล้างช่อง
  const [text, setText] = useState(batch || '');
  useEffect(() => { setText(batch || ''); }, [batch]);
  return (
  <>
    <Form.Select
      size="sm"
      style={{ width: 170 }}
      value={machine || ''}
      onChange={(e) => onChange({ machine: e.target.value || null, batch })}
      aria-label="เครื่องจักร"
    >
      <option value="">ทุกเครื่อง</option>
      {machines.map((m) => <option key={m} value={m}>{m}</option>)}
    </Form.Select>
    <Form.Control
      size="sm"
      style={{ width: 180 }}
      list={`${id}-batches`}
      placeholder="Batch (ทั้งหมด)"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim();
        if (!v || batches.includes(v)) onChange({ machine, batch: v || null });
      }}
      aria-label="Batch"
    />
    <datalist id={`${id}-batches`}>
      {batches.map((b) => <option key={b} value={b} />)}
    </datalist>
  </>
  );
};

MachineBatchFilter.propTypes = {
  id: PropTypes.string.isRequired,
  machines: PropTypes.arrayOf(PropTypes.string).isRequired,
  batches: PropTypes.arrayOf(PropTypes.string).isRequired,
  machine: PropTypes.string,
  batch: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

export default MachineBatchFilter;
