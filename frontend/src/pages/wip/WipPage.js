import React from 'react';
import { Tabs, Tab } from 'react-bootstrap';
import SearchTab from './SearchTab';
import SummaryTab from './SummaryTab';
import PageHeader from '../../components/shared/PageHeader';

// WIP (Work In Progress) — port จาก wip_main_screen.dart
// เปิดที่แท็บ Dashboard เป็นค่าเริ่มต้น (Flutter initialIndex: 1)
const WipPage = () => (
  <div className="container-fluid py-3">
    <PageHeader icon="bi-box-seam" title="WIP" subtitle="งานระหว่างผลิตคงค้างในแต่ละขั้นตอน" />
    <Tabs defaultActiveKey="summary" className="mb-3">
      <Tab eventKey="search" title="ค้นหารายการ (Search)">
        <SearchTab />
      </Tab>
      <Tab eventKey="summary" title="สรุปภาพรวม (Dashboard)">
        <SummaryTab />
      </Tab>
    </Tabs>
  </div>
);

export default WipPage;
