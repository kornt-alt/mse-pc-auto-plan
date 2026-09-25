import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Form, Button, Spinner } from 'react-bootstrap';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import { apiCall } from '../../api/client';
import { ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';

// WIP ค้นหารายการ — port จาก wip_screen_batch.dart (ปรับหน้าตาเข้าชุดหน้ารายงาน + Excel/พิมพ์ 2026-09-25)
const SearchTab = ({ today }) => {
  const [options, setOptions] = useState({ batches: [], descriptions: [], models: [] });
  const [searchDesc, setSearchDesc] = useState('');
  const [searchBatch, setSearchBatch] = useState('');
  const [wipData, setWipData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast, showToast, hideToast } = useToast();

  useEffect(() => {
    apiCall('/wip/options')
      .then(setOptions)
      .catch(() => {}); // เดิมแค่ print ไม่แจ้งเตือน
  }, []);

  const combined = [...new Set([...(options.descriptions || []), ...(options.models || [])])].sort();

  const fetchWipData = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (searchBatch.trim()) params.set('batch', searchBatch.trim());
      if (searchDesc.trim()) params.set('description', searchDesc.trim());
      const res = await apiCall(`/wip?${params.toString()}`);
      setWipData(res.data || []);
    } catch (err) {
      // apiCall รวม error ทุกแบบเป็น throw เดียว (ของเดิมแยก "เกิดข้อผิดพลาดจาก Server: {code}")
      showToast(`ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${err.message}`, 'danger');
      setWipData([]);
    } finally {
      setLoading(false);
    }
  }, [searchBatch, searchDesc, showToast]);

  const resetSearch = () => {
    setSearchDesc('');
    setSearchBatch('');
    setWipData([]);
    setHasSearched(false);
  };

  const filters = [
    searchDesc.trim() ? `Description/Model "${searchDesc.trim()}"` : null,
    searchBatch.trim() ? `Batch "${searchBatch.trim()}"` : null,
  ].filter(Boolean).join(' · ') || 'ทั้งหมด';
  const totalQty = wipData.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const handleExport = () => exportWorkbook(stampedFilename('wip_search', today), [{
    name: 'WIP',
    header: [
      { key: 'description', label: 'Description' },
      { key: 'model', label: 'Model' },
      { key: 'batch', label: 'Batch' },
      { key: 'step', label: 'Step' },
      { key: 'qty', label: 'Qty' },
    ],
    rows: wipData,
  }], { title: 'WIP — ผลการค้นหา', filters, asOf: today });

  return (
    <div>
      <PrintHeader title="WIP — ผลการค้นหา" filters={filters} asOf={today} />
      <Form
        className="rpt-toolbar align-items-end"
        onSubmit={(e) => {
          e.preventDefault();
          fetchWipData();
        }}
      >
        <Form.Group style={{ minWidth: 240, flex: 1 }}>
          <Form.Label className="small mb-0">Description / Model</Form.Label>
          <Form.Control size="sm" list="wip-desc-options" value={searchDesc} onChange={(e) => setSearchDesc(e.target.value)} />
          <datalist id="wip-desc-options">
            {combined.map((v) => <option key={v} value={v} />)}
          </datalist>
        </Form.Group>
        <Form.Group style={{ minWidth: 200, flex: 1 }}>
          <Form.Label className="small mb-0">Batch</Form.Label>
          <Form.Control size="sm" list="wip-batch-options" value={searchBatch} onChange={(e) => setSearchBatch(e.target.value)} />
          <datalist id="wip-batch-options">
            {(options.batches || []).map((v) => <option key={v} value={v} />)}
          </datalist>
        </Form.Group>
        <Button type="submit" size="sm" className="btn-mse">
          <i className="bi bi-search me-1" aria-hidden="true" />ค้นหา
        </Button>
        <Button type="button" size="sm" variant="outline-secondary" onClick={resetSearch}>
          <i className="bi bi-x-lg me-1" aria-hidden="true" />ล้าง
        </Button>
        {wipData.length > 0 && <ReportActions onExcel={handleExport} />}
      </Form>

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : !hasSearched ? (
        <div className="empty-state"><i className="bi bi-search" aria-hidden="true" /><div>พิมพ์คำค้นหาเพื่อดูข้อมูล WIP</div></div>
      ) : wipData.length === 0 ? (
        <div className="empty-state"><i className="bi bi-inbox" aria-hidden="true" /><div>ไม่พบข้อมูลที่ค้นหา</div></div>
      ) : (
        <>
          <div className="rpt-note">{wipData.length} รายการ · รวม {Math.trunc(totalQty).toLocaleString()} ชิ้น</div>
          <div className="rpt-wrap">
            <table className="rpt-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Description</th>
                  <th style={{ minWidth: 120 }}>Model</th>
                  <th style={{ minWidth: 120 }}>Batch</th>
                  <th style={{ minWidth: 140 }}>Step</th>
                  <th className="text-end" style={{ minWidth: 70 }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {wipData.map((row, i) => (
                  <tr key={i}>
                    <td>{row.description}</td>
                    <td>{row.model}</td>
                    <td className="num">{row.batch}</td>
                    <td>{row.step}</td>
                    <td className="text-end fw-bold num text-primary">{row.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ToastHost toast={toast} onClose={hideToast} />
    </div>
  );
};

SearchTab.propTypes = { today: PropTypes.string.isRequired };

export default SearchTab;
