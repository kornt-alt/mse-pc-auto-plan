import React from 'react';
import PropTypes from 'prop-types';
import { Form, ButtonGroup, Button } from 'react-bootstrap';
import { addDays } from '../../utils/dates';

/**
 * เลือกช่วงวัน from–to ('YYYY-MM-DD') + ปุ่มลัด 7/14/30 วันนับจาก today
 * from/to ว่าง = ไม่จำกัด
 */
const PRESETS = [7, 14, 30];

const DateRangeFilter = ({ from, to, today, onChange }) => (
  <div className="d-flex align-items-center gap-1 flex-wrap">
    <span className="small text-muted">ช่วงวัน</span>
    <Form.Control
      type="date"
      size="sm"
      style={{ width: 140 }}
      value={from || ''}
      onChange={(e) => onChange({ from: e.target.value, to })}
      aria-label="ตั้งแต่วันที่"
    />
    <span className="small text-muted">ถึง</span>
    <Form.Control
      type="date"
      size="sm"
      style={{ width: 140 }}
      value={to || ''}
      onChange={(e) => onChange({ from, to: e.target.value })}
      aria-label="ถึงวันที่"
    />
    <ButtonGroup size="sm">
      {PRESETS.map((n) => (
        <Button
          key={n}
          variant="outline-secondary"
          onClick={() => onChange({ from: today, to: addDays(today, n - 1) })}
        >
          {n} วัน
        </Button>
      ))}
      <Button variant="outline-secondary" onClick={() => onChange({ from: '', to: '' })}>
        ทั้งหมด
      </Button>
    </ButtonGroup>
  </div>
);

DateRangeFilter.propTypes = {
  from: PropTypes.string,
  to: PropTypes.string,
  today: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default DateRangeFilter;
