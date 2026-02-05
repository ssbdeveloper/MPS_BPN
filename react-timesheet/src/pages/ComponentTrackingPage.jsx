import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageContainer,
  AppHeader,
  Button,
  SearchRow,
  TextBox,
  Gallery
} from '../components';

/**
 * Component Tracking Page
 * Halaman untuk tracking komponen dan material
 */
const ComponentTrackingPage = () => {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(null);

  // Demo data - nanti akan diganti dengan data dari API
  const components = [
    {
      id: 'COMP-001',
      name: 'Motor Assembly',
      category: 'Electronic',
      stock: 245,
      location: 'Warehouse A-12',
      status: 'Available',
      lastUpdate: '2026-02-05 10:30'
    },
    {
      id: 'COMP-002',
      name: 'Gear Box Unit',
      category: 'Mechanical',
      stock: 89,
      location: 'Warehouse B-05',
      status: 'Available',
      lastUpdate: '2026-02-05 09:15'
    },
    {
      id: 'COMP-003',
      name: 'Control Panel',
      category: 'Electronic',
      stock: 12,
      location: 'Warehouse A-15',
      status: 'Low Stock',
      lastUpdate: '2026-02-05 08:45'
    },
    {
      id: 'COMP-004',
      name: 'Hydraulic Pump',
      category: 'Hydraulic',
      stock: 156,
      location: 'Warehouse C-08',
      status: 'Available',
      lastUpdate: '2026-02-04 16:20'
    },
    {
      id: 'COMP-005',
      name: 'Bearing Set',
      category: 'Mechanical',
      stock: 0,
      location: 'Warehouse B-12',
      status: 'Out of Stock',
      lastUpdate: '2026-02-03 14:30'
    }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'Available':
        return 'bg-green-100 text-green-700';
      case 'Low Stock':
        return 'bg-yellow-100 text-yellow-700';
      case 'Out of Stock':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleItemClick = (item, index) => {
    setSelectedIndex(index);
    console.log('Selected component:', item);
  };

  return (
    <PageContainer>
      <AppHeader
        title="📦 Component Tracking"
        rightContent={
          <Button variant="secondary" size="small" onClick={() => navigate('/')}>
            ← Back
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm">Total Components</span>
            <span className="text-2xl">📦</span>
          </div>
          <div className="text-3xl font-bold text-gray-800">502</div>
          <div className="text-xs text-gray-500 mt-1">5 categories</div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm">Available</span>
            <span className="text-2xl">✅</span>
          </div>
          <div className="text-3xl font-bold text-green-600">490</div>
          <div className="text-xs text-gray-500 mt-1">97.6% of total</div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm">Low Stock</span>
            <span className="text-2xl">⚠️</span>
          </div>
          <div className="text-3xl font-bold text-yellow-600">12</div>
          <div className="text-xs text-gray-500 mt-1">Need reorder</div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm">Out of Stock</span>
            <span className="text-2xl">❌</span>
          </div>
          <div className="text-3xl font-bold text-red-600">0</div>
          <div className="text-xs text-gray-500 mt-1">0% critical</div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="bg-white rounded-xl p-4 shadow-md">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">
            ➕ Add Component
          </Button>
          <Button variant="success">
            📥 Import Data
          </Button>
          <Button variant="warning">
            📊 Reports
          </Button>
          <Button variant="secondary">
            🔄 Sync Stock
          </Button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="bg-white rounded-xl p-4 shadow-md">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <SearchRow
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Cari component ID, nama, atau kategori..."
              onSearch={() => console.log('Search:', searchValue)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="small">
              📷 Scan Barcode
            </Button>
            <Button variant="secondary" size="small">
              🔍 Advanced Filter
            </Button>
          </div>
        </div>
      </div>

      {/* Component List */}
      <div className="bg-white rounded-xl p-4 shadow-md flex-1 overflow-hidden flex flex-col">
        <h3 className="font-bold text-lg text-gray-800 mb-4">Component List</h3>

        {/* Table Header */}
        <div className="grid grid-cols-[1fr_2fr_1fr_1fr_1.5fr_1fr] gap-3 p-3 bg-gray-100 rounded-lg font-semibold text-sm text-gray-700 mb-2">
          <div>Component ID</div>
          <div>Name</div>
          <div className="text-center">Category</div>
          <div className="text-center">Stock</div>
          <div className="text-center">Location</div>
          <div className="text-center">Status</div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {components.map((component, index) => (
            <div
              key={component.id}
              onClick={() => handleItemClick(component, index)}
              className={`
                grid grid-cols-[1fr_2fr_1fr_1fr_1.5fr_1fr] gap-3 p-3
                border border-gray-200 rounded-lg cursor-pointer
                transition-all duration-200 hover:shadow-md
                ${selectedIndex === index ? 'bg-blue-50 border-primary' : 'bg-white'}
              `}
            >
              <div className="font-mono text-sm font-semibold text-primary">
                {component.id}
              </div>
              <div className="font-medium text-gray-800">
                {component.name}
              </div>
              <div className="text-center">
                <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                  {component.category}
                </span>
              </div>
              <div className="text-center font-semibold text-gray-800">
                {component.stock}
              </div>
              <div className="text-center text-sm text-gray-600">
                {component.location}
              </div>
              <div className="text-center">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(component.status)}`}>
                  {component.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Component Details */}
      {selectedIndex !== null && (
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-5 shadow-md border border-primary/20">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-bold text-lg text-gray-800">Component Details</h3>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setSelectedIndex(null)}
            >
              ✕
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TextBox variant="order">
              <div className="text-xs text-gray-600">Component ID</div>
              <div className="font-bold">{components[selectedIndex].id}</div>
            </TextBox>
            <TextBox variant="act">
              <div className="text-xs text-gray-600">Name</div>
              <div className="font-bold">{components[selectedIndex].name}</div>
            </TextBox>
            <TextBox variant="seq">
              <div className="text-xs text-gray-600">Category</div>
              <div className="font-bold">{components[selectedIndex].category}</div>
            </TextBox>
            <TextBox variant="hrs">
              <div className="text-xs text-gray-600">Stock</div>
              <div className="font-bold">{components[selectedIndex].stock}</div>
            </TextBox>
            <TextBox variant="wct">
              <div className="text-xs text-gray-600">Location</div>
              <div className="font-bold text-xs">{components[selectedIndex].location}</div>
            </TextBox>
            <TextBox>
              <div className="text-xs text-gray-600">Last Update</div>
              <div className="font-bold text-xs">{components[selectedIndex].lastUpdate}</div>
            </TextBox>
          </div>
          <div className="mt-4 flex gap-3">
            <Button variant="primary" size="small">
              ✏️ Edit
            </Button>
            <Button variant="success" size="small">
              📦 Adjust Stock
            </Button>
            <Button variant="warning" size="small">
              📊 History
            </Button>
            <Button variant="danger" size="small">
              🗑️ Delete
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
};

export default ComponentTrackingPage;
