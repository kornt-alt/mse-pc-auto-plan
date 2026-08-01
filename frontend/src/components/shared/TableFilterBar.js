// แถบฟิลเตอร์เหนือตาราง — render จาก fields spec ชุดเดียวกับ useTableFilter
// text = ช่องพิมพ์ + datalist suggestion (กลไกเดิมของโปรเจกต์: wip/SearchTab, planActual/ByBatchTab)
// select = dropdown ที่มี "-- ทั้งหมด --" เป็นตัวแรก
import React from 'react';
import PropTypes from 'prop-types';
import { Form, Button } from 'react-bootstrap';

const TableFilterBar = ({ id, fields, filters, options, activeCount, onChange, onReset, children }) => (
  <div className="mse-toolbar" style={{ alignItems: 'flex-end' }}>
    {fields.map((field) => {
      const inputId = `${id}-${field.key}`;
      const value = filters[field.key] ?? '';
      const list = options[field.key] || [];
      return (
        <Form.Group key={field.key} style={{ minWidth: field.width || 150 }}>
          <Form.Label htmlFor={inputId} className="small text-muted mb-1">
            {field.label}
          </Form.Label>
          {field.type === 'select' ? (
            <Form.Select
              id={inputId}
              size="sm"
              value={value}
              onChange={(e) => onChange(field.key, e.target.value)}
            >
              <option value="">-- ทั้งหมด --</option>
              {list.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Form.Select>
          ) : (
            <>
              <Form.Control
                id={inputId}
                size="sm"
                list={`${inputId}-list`}
                autoComplete="off"
                placeholder={field.placeholder || ''}
                value={value}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
              <datalist id={`${inputId}-list`}>
                {list.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </>
          )}
        </Form.Group>
      );
    })}

    {activeCount > 0 && (
      <div>
        {/* label ล่องหน — ให้ปุ่มอยู่ระดับเดียวกับช่องกรอกที่มี label อยู่ข้างบน */}
        <div className="small mb-1" aria-hidden="true">
          &nbsp;
        </div>
        <Button size="sm" variant="outline-secondary" onClick={onReset}>
          <i className="bi bi-x-circle me-1" aria-hidden="true" />
          ล้างฟิลเตอร์ ({activeCount})
        </Button>
      </div>
    )}

    {children && <div className="mse-toolbar__end">{children}</div>}
  </div>
);

TableFilterBar.propTypes = {
  id: PropTypes.string.isRequired, // ต้องต่างกันรายหน้า — datalist id ซ้ำกันไม่ได้
  fields: PropTypes.array.isRequired,
  filters: PropTypes.object.isRequired,
  options: PropTypes.object.isRequired,
  activeCount: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  onReset: PropTypes.func.isRequired,
  children: PropTypes.node,
};

export default TableFilterBar;
