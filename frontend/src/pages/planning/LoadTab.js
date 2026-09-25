// Load — ภาระเครื่องจักรรายสัปดาห์ (heatmap เครื่อง × สัปดาห์) จากแผนล่าสุด (ไม่มีต้นฉบับใน Flutter)
// ทำด้วยตาราง + สีพื้นหลังล้วน — ห้ามเพิ่ม chart library (เครื่อง plant ไม่มีอินเทอร์เน็ต ส่ง node_modules ด้วยมือ)
// คำนวณใน weeklyLoad.js (pure) จาก planData ตัวเดียวกับแท็บ Schedule · กดช่อง = เปิดแท็บ Schedule ของเครื่อง/สัปดาห์นั้น
import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';
import { buildWeeklyLoad, loadTone } from './weeklyLoad';
import { loadSheet } from './planReport';
import { ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { weekStartOf } from '../../utils/dates';

const shortWeek = (w) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;

const LoadTab = ({ planData, today, asOf, onOpenSchedule }) => {
  const [onlyBusy, setOnlyBusy] = useState(false);
  const { weeks, rows } = useMemo(() => buildWeeklyLoad(planData), [planData]);
  const visible = onlyBusy ? rows.filter((r) => r.peakPct >= 70) : rows;
  const thisWeek = weekStartOf(today);
  const title = 'Load — ภาระเครื่องจักรรายสัปดาห์';
  const filters = onlyBusy ? 'เฉพาะเครื่องที่ peak ≥ 70%' : 'ทุกเครื่องที่มีงาน';

  const handleExport = () => exportWorkbook(stampedFilename('machine_load', today), [loadSheet(weeks, visible)], { title, filters, asOf });

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-speedometer2" aria-hidden="true" />
        <div>ไม่มีข้อมูลแผน (กด Replan ที่หน้า Orders)</div>
      </div>
    );
  }

  return (
    <div>
      <PrintHeader title={title} filters={filters} asOf={asOf} />
      <div className="rpt-toolbar">
        <Form.Check
          type="switch"
          id="load-only-busy"
          label="เฉพาะเครื่องที่ peak ≥ 70%"
          checked={onlyBusy}
          onChange={(e) => setOnlyBusy(e.target.checked)}
        />
        <span className="small text-muted">
          <span className="chip chip-ok me-1">&lt; 70%</span>
          <span className="chip chip-warn me-1">70–90%</span>
          <span className="chip chip-ng">&gt; 90%</span>
        </span>
        <ReportActions onExcel={handleExport} />
      </div>
      <div className="rpt-note no-print">
        % = นาทีที่แผนใช้ ÷ นาทีตามปฏิทิน (รวมเวลา setup) · ตัวหนา = เกิน 100% · ! = มีงานแต่ไม่มีปฏิทิน · กดช่องเพื่อดูงานในสัปดาห์นั้น
      </div>

      <div className="rpt-wrap">
        <table className="rpt-table">
          <thead>
            <tr>
              <th className="frozen frozen-last" style={{ left: 0, minWidth: 130 }}>Machine</th>
              <th className="text-end" style={{ minWidth: 70 }}>Peak</th>
              {weeks.map((w) => (
                <th key={w} className={`col-date${w === thisWeek ? ' col-today' : ''}`} title={`สัปดาห์เริ่ม ${w}`}>
                  {shortWeek(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.machine}>
                <td className="frozen frozen-last fw-bold" style={{ left: 0, minWidth: 130 }}>{r.machine}</td>
                <td className={`text-end num fw-bold tone-${loadTone(r.peakPct)}`}>{r.peakPct}%</td>
                {weeks.map((w) => {
                  const c = r.cells[w];
                  const empty = c.used === 0;
                  const tone = c.pct === null ? (c.used > 0 ? 'ng' : null) : empty ? null : loadTone(c.pct);
                  const cls = ['col-date num', tone ? `tone-${tone}` : 'tone-muted', w === thisWeek ? 'col-today' : '']
                    .filter(Boolean).join(' ');
                  return (
                    <td
                      key={w}
                      className={cls}
                      style={{ fontWeight: c.pct > 100 ? 700 : 400, cursor: empty ? 'default' : 'pointer' }}
                      title={`ใช้ ${c.used} / มี ${c.avail} นาที`}
                      onClick={empty ? undefined : () => onOpenSchedule(r.machine, w)}
                    >
                      {c.pct === null ? (c.used > 0 ? '!' : '') : empty ? '·' : `${c.pct}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

LoadTab.propTypes = {
  planData: PropTypes.array.isRequired,
  today: PropTypes.string.isRequired,
  asOf: PropTypes.string,
  onOpenSchedule: PropTypes.func.isRequired,
};

export default LoadTab;
