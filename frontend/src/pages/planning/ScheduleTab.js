// Schedule — ตารางแผนรายเครื่อง × วัน (เดิม "Planing Chart" / OverviewTab port จาก overview_tab.dart)
// ตรรกะอยู่ใน scheduleMatrix.js (pure) · filter ถูกยกไปถือที่ PlanningView เพื่อให้แท็บ Load กดส่งมาที่นี่ได้
import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { buildScheduleMatrix, planOptions } from './scheduleMatrix';
import { loadTone } from './weeklyLoad';
import { scheduleSheet } from './planReport';
import MachineBatchFilter from './MachineBatchFilter';
import { ReportActions, PrintHeader, DateRangeFilter } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { isWeekend, shortDateLabel, diffDays } from '../../utils/dates';

const PRINT_MAX_DAYS = 10;
const FROZEN = [
  { key: 'machine', label: 'Machine', left: 0, width: 100 },
  { key: 'batch', label: 'Batch', left: 100, width: 120 },
  { key: 'step', label: 'Process', left: 220, width: 130 },
];

export const filterText = ({ machine, batch, from, to }) =>
  [machine ? `เครื่อง ${machine}` : 'ทุกเครื่อง', batch ? `Batch ${batch}` : null,
    from || to ? `${from || '…'} ถึง ${to || '…'}` : 'ทุกวัน'].filter(Boolean).join(' · ');

const ScheduleTab = ({ planData, filter, onFilterChange, today, asOf }) => {
  const { machines, batches } = useMemo(() => planOptions(planData), [planData]);
  const matrix = useMemo(() => buildScheduleMatrix(planData, filter), [planData, filter]);
  const { dates, rows, dayLoad } = matrix;

  const span = filter.from && filter.to ? diffDays(filter.from, filter.to) + 1 : dates.length;
  const printWarning = span > PRINT_MAX_DAYS
    ? `ช่วงที่เลือกมี ${span} วัน — กระดาษ A4 แนวนอนพิมพ์ได้ราว ${PRINT_MAX_DAYS} วัน คอลัมน์ที่เกินจะถูกตัด แนะนำเลือกช่วงให้สั้นลงก่อน`
    : null;

  const handleExport = () => exportWorkbook(
    stampedFilename('schedule', today),
    [scheduleSheet(matrix)],
    { title: 'Schedule — แผนรายเครื่องรายวัน', filters: filterText(filter), asOf },
  );

  return (
    <div>
      <PrintHeader title="Schedule — แผนรายเครื่องรายวัน" filters={filterText(filter)} asOf={asOf} />
      <div className="rpt-toolbar">
        <MachineBatchFilter
          id="schedule"
          machines={machines}
          batches={batches}
          machine={filter.machine}
          batch={filter.batch}
          onChange={(v) => onFilterChange({ ...filter, ...v })}
        />
        <DateRangeFilter
          from={filter.from}
          to={filter.to}
          today={today}
          onChange={(v) => onFilterChange({ ...filter, ...v })}
        />
        <ReportActions onExcel={handleExport} excelDisabled={rows.length === 0} printWarning={printWarning} />
      </div>
      <div className="rpt-note no-print">
        หัวคอลัมน์ = % ภาระของเครื่องที่แสดงอยู่ในวันนั้น
        <span className="chip chip-ok ms-2">&lt; 70%</span>
        <span className="chip chip-warn ms-1">70–90%</span>
        <span className="chip chip-ng ms-1">&gt; 90%</span>
        <span className="cell-job d-inline-block ms-2 px-2">งาน = จำนวนชิ้น</span>
        <span className="cell-job cell-setup d-inline-block ms-1 px-2">Setup = นาที</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-calendar-x" aria-hidden="true" />
          <div>ไม่มีงานในแผนตามเงื่อนไขนี้</div>
        </div>
      ) : (
        <div className="rpt-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                {FROZEN.map((c, i) => (
                  <th
                    key={c.key}
                    className={`frozen${i === FROZEN.length - 1 ? ' frozen-last' : ''}`}
                    style={{ left: c.left, minWidth: c.width, maxWidth: c.width }}
                  >
                    {c.label}
                  </th>
                ))}
                {dates.map((d) => {
                  const { label, day } = shortDateLabel(d);
                  const ld = dayLoad[d];
                  const tone = ld.pct == null ? null : loadTone(ld.pct);
                  const cls = ['col-date', isWeekend(d) ? 'col-weekend' : '', d === today ? 'col-today' : '']
                    .filter(Boolean).join(' ');
                  return (
                    <th key={d} className={cls} title={`${d} · ใช้ ${ld.used} / มี ${ld.avail} นาที`}>
                      <div className="date-head">
                        {label} {day}
                        <small className={tone && d !== today ? `tone-${tone}` : ''}>
                          {ld.pct == null ? 'ไม่มีปฏิทิน' : `${ld.pct}%`}
                        </small>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="frozen fw-bold" style={{ left: FROZEN[0].left, minWidth: FROZEN[0].width, maxWidth: FROZEN[0].width }}>
                    {r.machine}
                  </td>
                  <td className="frozen num" style={{ left: FROZEN[1].left, minWidth: FROZEN[1].width, maxWidth: FROZEN[1].width }} title={r.model}>
                    {r.batch}
                  </td>
                  <td
                    className="frozen frozen-last text-truncate"
                    style={{ left: FROZEN[2].left, minWidth: FROZEN[2].width, maxWidth: FROZEN[2].width }}
                    title={r.step}
                  >
                    {r.step}
                  </td>
                  {dates.map((d) => {
                    const v = r.cells[d];
                    const cls = ['col-date', isWeekend(d) ? 'col-weekend' : '', d === today ? 'col-today' : '']
                      .filter(Boolean).join(' ');
                    return (
                      <td key={d} className={cls}>
                        {v != null && v !== '' && (
                          <span className={`cell-job${r.isSetup ? ' cell-setup' : ''}`}>{String(v).replace(' pcs', '')}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

ScheduleTab.propTypes = {
  planData: PropTypes.array.isRequired,
  filter: PropTypes.shape({
    machine: PropTypes.string,
    batch: PropTypes.string,
    from: PropTypes.string,
    to: PropTypes.string,
  }).isRequired,
  onFilterChange: PropTypes.func.isRequired,
  today: PropTypes.string.isRequired,
  asOf: PropTypes.string,
};

export default ScheduleTab;
