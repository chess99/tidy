import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { VirtualGrid } from './components/VirtualGrid';
import { scanPath, updateAssetStatus, syncChanges } from './api/client';
import { Trash2, FolderCheck, X, RefreshCw } from 'lucide-react';

const queryClient = new QueryClient();

function Main() {
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [pathInput, setPathInput] = useState('D:\\Photos'); // Default example
  const qc = useQueryClient();

  const scanMutation = useMutation({
    mutationFn: scanPath,
    onSuccess: () => {
      alert('Scan started');
    }
  });

  const syncMutation = useMutation({
    mutationFn: syncChanges,
    onSuccess: (data) => {
      alert(`Sync Complete!\nMoved: ${data.moved}\nDeleted: ${data.deleted}`);
      qc.invalidateQueries(['assets']);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ hash, status }) => updateAssetStatus(hash, status),
    onSuccess: () => {
      qc.invalidateQueries(['assets']);
      setSelectedAsset(prev => prev ? { ...prev, status: updateStatusMutation.variables.status } : null);
    }
  });

  const handleStatusChange = (status) => {
    if (!selectedAsset) return;
    updateStatusMutation.mutate({ hash: selectedAsset.hash, status });
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="bg-white border-b p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Tidy Photo Organizer</h1>
        <div className="flex gap-2">
          <input 
            type="text" 
            value={pathInput} 
            onChange={e => setPathInput(e.target.value)} 
            className="border rounded px-2 py-1 w-64"
          />
          <button 
            onClick={() => scanMutation.mutate(pathInput)}
            className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700"
          >
            Scan
          </button>
          <button 
            onClick={() => syncMutation.mutate()}
            className="bg-red-600 text-white px-4 py-1 rounded hover:bg-red-700 flex items-center gap-2"
          >
            <RefreshCw size={16}/> Sync
          </button>
        </div>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1">
          <VirtualGrid onAssetClick={setSelectedAsset} />
        </div>

        {selectedAsset && (
          <aside className="w-80 bg-white border-l p-4 flex flex-col gap-4 overflow-y-auto">
            <div className="flex justify-between items-start">
              <h2 className="font-bold">Details</h2>
              <button onClick={() => setSelectedAsset(null)}><X size={16}/></button>
            </div>
            
            <img 
              src={`http://localhost:3001/api/assets/${selectedAsset.hash}/thumb`} 
              className="w-full rounded" 
            />
            
            <div className="space-y-2 text-sm">
              <div><strong>Date:</strong> {new Date(selectedAsset.taken_at).toLocaleString()}</div>
              <div><strong>Size:</strong> {(selectedAsset.size / 1024 / 1024).toFixed(2)} MB</div>
              <div><strong>Status:</strong> {selectedAsset.status}</div>
            </div>

            <div className="flex gap-2 mt-4">
              <button 
                onClick={() => handleStatusChange('trash')}
                className="flex-1 flex items-center justify-center gap-2 bg-red-100 text-red-700 py-2 rounded hover:bg-red-200"
              >
                <Trash2 size={16} /> Trash
              </button>
              <button 
                onClick={() => handleStatusChange('sorted')}
                className="flex-1 flex items-center justify-center gap-2 bg-green-100 text-green-700 py-2 rounded hover:bg-green-200"
              >
                <FolderCheck size={16} /> Keep
              </button>
            </div>

            <div className="mt-4">
              <h3 className="font-bold mb-2">Physical Files</h3>
              <ul className="text-xs space-y-1">
                 {/* Files list would need to be fetched or passed if we want to show it here. 
                     For now, we know the asset, we can fetch details. */}
                 <li className="text-gray-500 italic">Fetch details to see paths...</li>
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Main />
    </QueryClientProvider>
  );
}
