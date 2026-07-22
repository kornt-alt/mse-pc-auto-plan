// แถบ filter Machine/Batch + Reset + Export CSV (ใช้ร่วม Overview/Detailed)
// ตาม filter bar ของ overview_tab.dart / detailed_tab.dart
import React from 'react';
import { Form, Button } from 'react-bootstrap';

const FilterBar = ({
  machineList,
  batchList,
  selectedMachine,
  selectedBatch,
  onMachineChange,
  onBatchChange,
  onReset,
  onExport,
}) => (
  <div className="planning-filterbar d-flex align-items-end gap-3 flex-wrap">
    <Form.Group>
      <Form.Label className="mb-1 fw-bold" style={{ fontSize: 12 }}>
        Filter Machine:
      </Form.Label>
      <Form.Select
        size="sm"
        style={{ width: 200 }}
        value={selectedMachine ?? ''}
        onChange={(e) => onMachineChange(e.target.value || null)}
      >
        <option value="">-- ทั้งหมด --</option>
        {machineList.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
    <Form.Group>
      <Form.Label className="mb-1 fw-bold" style={{ fontSize: 12 }}>
        Filter Batch:
      </Form.Label>
      <Form.Select
        size="sm"
        style={{ width: 220 }}
        value={selectedBatch ?? ''}
        onChange={(e) => onBatchChange(e.target.value || null)}
      >
        <option value="">-- ทั้งหมด --</option>
        {batchList.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
    <Button variant="secondary" size="sm" onClick={onReset}>
      <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
      Reset
    </Button>
    <Button variant="success" size="sm" onClick={onExport}>
      <i className="bi bi-download me-1" aria-hidden="true" />
      Export CSV
    </Button>
  </div>
);

export default FilterBar;
