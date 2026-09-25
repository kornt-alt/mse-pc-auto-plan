// Dispatch List — ใบสั่งงานรายเครื่องรายวัน (แทน "Planing Table" / DetailedTab เดิม)
// จัดกลุ่มเครื่อง → วัน ใน dispatchList.js (pure) · พิมพ์ 1 เครื่องต่อหน้า (print.css .print-page-group)
import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { buildDispatchList, flattenDispatch } from './dispatchList';
import { planOptions } from './scheduleMatrix';
import { dispatchSheet } from './planReport';
import { filterText } from './ScheduleTab';
import MachineBatchFilter from './MachineBatchFilter';
import { ReportActions, PrintHeader, DateRangeFilter } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { addDays, shortDateLabel } from '../../utils/dates';

const DispatchTab = ({ planData, today, asOf }) => {
  const [filter, setFilter] = useState({ machine: null, batch: null, from: today, to: addDays(today, 2) });
  const { machines, batches } = useMemo(() => planOptions(planData), [planData]);
  const groups = useMemo(() => buildDispatchList(planData, filter), [planData, filter]);
  const title = 'Dispatch List — ใบสั่งงานรายเครื่อง';

  const handleExport = () => exportWorkbook(
    stampedFilename('dispatch_list', today),
    [dispatchSheet(flattenDispatch(groups))],
    { title, filters: filterText(filter), asOf },
  );

  return (
    <div>
      <div className="rpt-toolbar">
        <MachineBatchFilter
          id="dispatch"
          machines={machines}
          batches={batches}
          machine={filter.machine}
          batch={filter.batch}
          onChange={(v) => setFilter((f) => ({ ...f, ...v }))}
        />
        <DateRangeFilter
          from={filter.from}
          to={filter.to}
          today={today}
          onChange={(v) => setFilter((f) => ({ ...f, ...v }))}
        />
        <ReportActions onExcel={handleExport} excelDisabled={groups.length === 0} />
      </div>
      <div className="rpt-note no-print">
        เรียงตามลำดับที่แผนวางในแต่ละวัน · แถวสีส้ม = Setup · พิมพ์ออกมาเครื่องละ 1 หน้า
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-clipboard-x" aria-hidden="true" />
          <div>ไม่มีงานตามเงื่อนไขนี้</div>
        </div>
      ) : (
        <div className="rpt-wrap">
          {groups.map((g) => (
            <div key={g.machine} className="print-page-group">
              <PrintHeader title={`${title} — ${g.machine}`} filters={filterText({ ...filter, machine: g.machine })} asOf={asOf} />
              <table className="rpt-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th style={{ minWidth: 130 }}>Batch</th>
                    <th style={{ minWidth: 120 }}>Model</th>
                    <th style={{ minWidth: 160 }}>Process</th>
                    <th className="text-end" style={{ minWidth: 70 }}>Qty</th>
                    <th className="text-end" style={{ minWidth: 80 }}>นาที</th>
                    <th style={{ minWidth: 70 }}>ประเภท</th>
                    <th style={{ minWidth: 110 }}>ผลจริง / หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="group-row">
                    <td colSpan={8}>
                      <i className="bi bi-gear-wide-connected me-1" aria-hidden="true" />
                      {g.machine}
                      <span className="ms-3 fw-normal small">รวม {g.totalMin.toLocaleString()} นาที</span>
                    </td>
                  </tr>
                  {g.days.map((d) => {
                    const { day } = shortDateLabel(d.date);
                    return (
                      <React.Fragment key={d.date}>
                        <tr className="subgroup-row">
                          <td colSpan={8}>
                            {d.date} ({day}) {d.date === today && <span className="chip chip-info ms-1">วันนี้</span>}
                            <span className="ms-3 fw-normal small">{d.items.length} งาน · {d.totalMin.toLocaleString()} นาที</span>
                          </td>
                        </tr>
                        {d.items.map((it, i) => (
                          <tr key={`${it.batch}|${it.step}|${it.isSetup}|${i}`} className={it.isSetup ? 'tone-warn' : ''}>
                            <td className="text-center text-muted">{i + 1}</td>
                            <td className="num">
                              {it.batch}
                              {it.isSub && <span className="small text-muted ms-1" title="batch ย่อย / PACK">↳ {it.parent}</span>}
                            </td>
                            <td>{it.model || '-'}</td>
                            <td>{it.step}</td>
                            <td className="text-end num">{it.isSetup ? '' : it.qty.toLocaleString()}</td>
                            <td className="text-end num">{it.minutes.toLocaleString()}</td>
                            <td>{it.isSetup ? 'Setup' : 'Run'}</td>
                            <td />
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

DispatchTab.propTypes = {
  planData: PropTypes.array.isRequired,
  today: PropTypes.string.isRequired,
  asOf: PropTypes.string,
};

export default DispatchTab;
