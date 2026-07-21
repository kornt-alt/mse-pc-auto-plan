import React, { useState } from 'react';
import { Modal, Table, Button } from 'react-bootstrap';
import { Pencil, Trash2 } from 'lucide-react';

// ประวัติการบันทึกของ step — port จาก _showHistoryDialog (shop_floor_screen.dart L761-926)
// แก้/ลบได้เฉพาะ record ของพนักงานที่สแกนอยู่ (employee ตรงกับ empCode)
const RecordHistoryDialog = ({ show, stepName, history, empCode, onEdit, onDelete, onHide }) => {
  const [confirmDelete, setConfirmDelete] = useState(null); // record ที่รอยืนยันลบ

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.05rem' }}>ประวัติการบันทึก: {stepName}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div style={{ overflowX: 'auto' }}>
          <Table bordered hover size="sm">
            <thead className="table-secondary">
              <tr>
                <th>Emp.</th>
                <th>Qty OK</th>
                <th>Qty NG</th>
                <th>Mode NG</th>
                <th>TimeStamp</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(history || []).map((h) => (
                <tr key={h.id}>
                  <td>{h.employee}</td>
                  <td className="text-end" style={{ color: '#2e7d32' }}>
                    {h.qtyOK}
                  </td>
                  <td
                    className="text-end"
                    style={h.qtyNG > 0 ? { color: '#c62828', fontWeight: 'bold' } : {}}
                  >
                    {h.qtyNG}
                  </td>
                  <td>{h.modeNG}</td>
                  <td>{h.timestamp}</td>
                  <td>
                    {h.employee === empCode && (
                      <>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 me-2"
                          onClick={() => onEdit(h)}
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-danger"
                          onClick={() => setConfirmDelete(h)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {(!history || history.length === 0) && (
                <tr>
                  <td colSpan={6} className="text-center text-muted">
                    ไม่มีประวัติ
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ปิดหน้าต่าง
        </Button>
      </Modal.Footer>

      <Modal show={!!confirmDelete} onHide={() => setConfirmDelete(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1rem' }}>ยืนยันการลบ</Modal.Title>
        </Modal.Header>
        <Modal.Body>คุณต้องการลบรายการนี้ใช่หรือไม่? (ลบแล้วกู้คืนไม่ได้)</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            ยกเลิก
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const rec = confirmDelete;
              setConfirmDelete(null);
              onDelete(rec);
            }}
          >
            ลบทิ้ง
          </Button>
        </Modal.Footer>
      </Modal>
    </Modal>
  );
};

export default RecordHistoryDialog;
