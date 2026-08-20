// CalendarGrid — ตาราง เครื่อง × วัน ของหน้า Calendar
// ตรรกะทั้งหมด (สร้างวัน, สี่เหลี่ยมที่เลือก, ยอดรวม) อยู่ใน calendarMatrix.js ที่เทสแยกไว้แล้ว
// ไฟล์นี้เหลือแค่การวาดกับการรับ mouse/keyboard
//
// การเลือก: mousedown ที่ช่อง = จุดยึด, ลากผ่านช่องอื่น = สี่เหลี่ยม, ปล่อยเมาส์ = จบการเลือก
//   ⚠️ ผูก mouseup ไว้ที่ document (ไม่ใช่ที่ตาราง) — ปล่อยเมาส์นอกตารางต้อง "จบการเลือกตามช่อง
//      สุดท้ายที่ลากผ่าน" ไม่ใช่ค้างสถานะลากไว้ ซึ่งเป็นจุดที่พังบ่อยถ้าไม่ทำ
//   คลิกช่องเดียวโดยไม่ลาก = เข้าโหมดแก้ inline ของช่องนั้น
import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  cellKey,
  rectangleKeys,
  columnKeys,
  rowKeys,
  selectionKeySet,
  machineTotal,
  dayTotal,
} from './calendarMatrix';

const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');

const CalendarGrid = ({
  days,
  machines,
  cellByKey,
  canEdit,
  selection,
  onSelectionChange,
  onCommitCell,
}) => {
  const [anchor, setAnchor] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(null); // {machine, date}
  const [editValue, setEditValue] = useState('');
  const movedRef = useRef(false);

  const selectedKeys = selectionKeySet(selection);

  const clearSelection = useCallback(() => {
    onSelectionChange([]);
    setAnchor(null);
  }, [onSelectionChange]);

  // จบการลากที่ระดับ document — ปล่อยเมาส์นอกตารางก็ต้องจบ
  useEffect(() => {
    if (!dragging) return undefined;
    const stop = () => {
      setDragging(false);
      // คลิกช่องเดียวไม่ได้ลากไปไหน = ตั้งใจจะแก้ช่องนั้น ไม่ใช่เลือก
      if (!movedRef.current && anchor) {
        const cur = cellByKey.get(cellKey(anchor.machine, anchor.date));
        setEditing(anchor);
        // ช่องที่ยังไม่มีแถวเริ่มด้วยค่าว่าง ไม่ใช่ '0' — ไม่งั้นแค่คลิกแล้วคลิกที่อื่น
        // (blur) ก็จะสร้างแถวเวลา 0 ให้เองโดยที่ผู้ใช้ไม่ได้ตั้งใจ
        setEditValue(cur ? String(cur.available_time) : '');
        onSelectionChange([]);
      }
    };
    document.addEventListener('mouseup', stop);
    return () => document.removeEventListener('mouseup', stop);
  }, [dragging, anchor, cellByKey, onSelectionChange]);

  // Esc = ล้างทุกอย่างที่ค้างอยู่
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setEditing(null);
      clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  const startDrag = (machine, date) => (e) => {
    if (!canEdit || e.button !== 0) return;
    e.preventDefault(); // กันการลากไฮไลต์ข้อความของ browser
    setEditing(null);
    movedRef.current = false;
    setAnchor({ machine, date });
    setDragging(true);
    onSelectionChange([{ machine, date }]);
  };

  const extendDrag = (machine, date) => () => {
    if (!dragging || !anchor) return;
    if (anchor.machine !== machine || anchor.date !== date) movedRef.current = true;
    onSelectionChange(rectangleKeys(anchor, { machine, date }, machines, days));
  };

  const commitEdit = () => {
    const target = editing;
    setEditing(null);
    if (!target) return;
    const value = parseFloat(editValue);
    if (Number.isNaN(value) || value < 0) return;
    const cur = cellByKey.get(cellKey(target.machine, target.date));
    if (cur && cur.available_time === value) return; // ไม่เปลี่ยน = ไม่ต้องยิง
    onCommitCell(target.machine, target.date, value);
  };

  const pickColumn = (date) => () => {
    if (!canEdit) return;
    setEditing(null);
    setAnchor(null);
    onSelectionChange(columnKeys(date, machines));
  };

  const pickRow = (machine) => () => {
    if (!canEdit) return;
    setEditing(null);
    setAnchor(null);
    onSelectionChange(rowKeys(machine, days));
  };

  return (
    <div className="cal-matrix-wrap">
      <table className="cal-matrix">
        <thead>
          <tr>
            <th className="cal-machine">Machine</th>
            {days.map((d) => (
              <th
                key={d.date}
                className={[
                  'cal-day',
                  'cal-day-head',
                  canEdit ? 'cal-pickable' : '',
                  d.isSunday ? 'cal-sun' : '',
                  d.isSaturday ? 'cal-sat' : '',
                  d.holiday ? 'cal-holiday' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  d.holiday
                    ? `${d.date} — ${d.holiday}`
                    : canEdit
                      ? `${d.date} (คลิกเพื่อเลือกทั้งวัน)`
                      : d.date
                }
                onClick={pickColumn(d.date)}
              >
                <div className="num">{d.day}</div>
                <div className="cal-dow">{d.dowLabel}</div>
              </th>
            ))}
            <th className="cal-total">รวม</th>
          </tr>
        </thead>

        <tbody>
          {machines.map((machine) => (
            <tr key={machine}>
              <td
                className={`cal-machine${canEdit ? ' cal-pickable' : ''}`}
                title={canEdit ? `${machine} (คลิกเพื่อเลือกทั้งเดือน)` : machine}
                onClick={pickRow(machine)}
              >
                {machine}
              </td>

              {days.map((d) => {
                const key = cellKey(machine, d.date);
                const cell = cellByKey.get(key);
                const isEditing =
                  editing && editing.machine === machine && editing.date === d.date;

                return (
                  <td
                    key={d.date}
                    className={[
                      'cal-day',
                      'cal-cell',
                      canEdit ? 'is-editable' : '',
                      !cell ? 'is-empty' : '',
                      cell && cell.available_time === 0 ? 'is-zero' : '',
                      selectedKeys.has(key) ? 'is-selected' : '',
                      d.holiday && !cell ? 'cal-holiday' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={
                      cell
                        ? `${machine} · ${d.date}`
                        : `${machine} · ${d.date} — ยังไม่มีในปฏิทิน${canEdit ? ' (ใส่เลขเพื่อสร้าง)' : ''}`
                    }
                    onMouseDown={isEditing ? undefined : startDrag(machine, d.date)}
                    onMouseEnter={extendDrag(machine, d.date)}
                  >
                    {isEditing ? (
                      <input
                        className="cal-cell-input num"
                        type="number"
                        min="0"
                        value={editValue}
                        autoFocus
                        aria-label={`เวลาที่ใช้ได้ ${machine} ${d.date}`}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="num">{cell ? fmt(cell.available_time) : '—'}</span>
                    )}
                  </td>
                );
              })}

              <td className="cal-total num">{fmt(machineTotal(machine, days, cellByKey))}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <td className="cal-machine">รวมต่อวัน</td>
            {days.map((d) => (
              <td key={d.date} className="cal-day num">
                {fmt(dayTotal(d.date, machines, cellByKey))}
              </td>
            ))}
            <td className="cal-total num">
              {fmt(machines.reduce((s, m) => s + machineTotal(m, days, cellByKey), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

CalendarGrid.propTypes = {
  days: PropTypes.arrayOf(PropTypes.object).isRequired,
  machines: PropTypes.arrayOf(PropTypes.string).isRequired,
  cellByKey: PropTypes.instanceOf(Map).isRequired,
  canEdit: PropTypes.bool,
  selection: PropTypes.arrayOf(PropTypes.object).isRequired,
  onSelectionChange: PropTypes.func.isRequired,
  onCommitCell: PropTypes.func.isRequired,
};

export default CalendarGrid;
