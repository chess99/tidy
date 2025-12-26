import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, FolderCheck, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';
import { getScanStatus, scanPath, syncChanges, updateAssetStatus } from './api/client';
import { VirtualGrid } from './components/VirtualGrid';

const queryClient = new QueryClient();

function ScanProgress() {
  const { data } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: getScanStatus,
    refetchInterval: 1000, 
  });

  if (!data) return null;

  if (data.isScanning) {
    return (
      <div className="bg-blue-50 px-4 py-2 text-sm flex gap-4 items-center border-b border-blue-100">
        <Loader2 className="animate-spin text-blue-600" size={16} />
        <span className="font-semibold text-blue-800">Scanning...</span>
        {data.stats.total > 0 && (
          <span className="text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full text-xs">
             Total: {data.stats.total}
          </span>
        )}
        <div className="flex gap-4 text-blue-600 text-xs">
          <span>Walked: {data.stats.walked}</span>
          <span>Processed: {data.stats.scanned}</span>
          <span className="text-green-600">New: {data.stats.new}</span>
          <span className="text-gray-500">Skip: {data.stats.skipped}</span>
          <span className="text-gray-400">Ignore: {data.stats.ignored}</span>
        </div>
      </div>
    );
  } else if (data.stats && data.stats.scanned > 0) {
     return (
      <div className="bg-green-50 px-4 py-2 text-sm flex gap-4 items-center border-b border-green-100 justify-between">
        <div className="flex gap-4 items-center">
          <CheckCircle className="text-green-600" size={16} />
          <span className="font-semibold text-green-800">Scan Complete</span>
          <div className="flex gap-4 text-green-700 text-xs">
             <span>Total: {data.stats.total}</span>
             <span>Walked: {data.stats.walked}</span>
             <span>Processed: {data.stats.scanned}</span>
             <span>New: {data.stats.new}</span>
             <span>Skip: {data.stats.skipped}</span>
             <span>Ignore: {data.stats.ignored}</span>
          </div>
          {data.stats.walked !== data.stats.total && (
              <div className="flex items-center gap-1 text-orange-600 text-xs font-bold">
                  <AlertTriangle size={12}/> Count Mismatch!
              </div>
          )}
        </div>
        <button onClick={() => window.location.reload()} className="text-green-600 hover:underline text-xs">Dismiss</button>
      </div>
    );
  }

  return null;
}

function Main() {
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [pathInput, setPathInput] = useState('D:\\Photos'); // Default example
  const qc = useQueryClient();

  const scanMutation = useMutation({
    mutationFn: scanPath,
    onSuccess: () => {
      // Trigger polling effectively by invalidating (though polling is set in ScanProgress)
      qc.invalidateQueries(['scanStatus']);
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
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm z-10">
        <h1 className="text-xl font-bold flex items-center gap-2">
          📸 Tidy <span className="text-xs font-normal text-gray-500">v0.1</span>
        </h1>
        <div className="flex gap-2">
          <input 
            type="text" 
            value={pathInput} 
            onChange={e => setPathInput(e.target.value)} 
            placeholder="Server path to scan..."
            className="border rounded px-3 py-1 w-80 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button 
            onClick={() => scanMutation.mutate(pathInput)}
            disabled={scanMutation.isPending}
            className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {scanMutation.isPending ? 'Starting...' : 'Scan'}
          </button>
          <div className="w-px bg-gray-300 mx-2"></div>
          <button 
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="bg-gray-100 text-gray-700 border border-gray-300 px-4 py-1 rounded hover:bg-gray-200 flex items-center gap-2 text-sm font-medium"
          >
            <RefreshCw size={14}/> Sync Files
          </button>
        </div>
      </header>

      <ScanProgress />
      
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <VirtualGrid onAssetClick={setSelectedAsset} />
        </div>

        {selectedAsset && (
          <aside className="w-96 bg-white border-l shadow-xl z-20 flex flex-col h-full">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-700">Details</h2>
              <button onClick={() => setSelectedAsset(null)} className="hover:bg-gray-200 p-1 rounded">
                <X size={18}/>
              </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-4 border">
                <img 
                  src={`http://localhost:3001/api/assets/${selectedAsset.hash}/thumb`} 
                  className="w-full h-full object-contain" 
                  alt="preview"
                />
              </div>
              
              <div className="space-y-3 text-sm text-gray-600">
                <div className="grid grid-cols-3 gap-2">
                   <div className="col-span-1 font-semibold">Date</div>
                   <div className="col-span-2">{new Date(selectedAsset.taken_at).toLocaleString()}</div>
                   
                   <div className="col-span-1 font-semibold">Size</div>
                   <div className="col-span-2">{(selectedAsset.size / 1024 / 1024).toFixed(2)} MB</div>

                   <div className="col-span-1 font-semibold">Status</div>
                   <div className="col-span-2 uppercase text-xs font-bold tracking-wider">
                     <span className={`px-2 py-0.5 rounded ${
                       selectedAsset.status === 'trash' ? 'bg-red-100 text-red-700' : 
                       selectedAsset.status === 'sorted' ? 'bg-green-100 text-green-700' : 'bg-gray-100'
                     }`}>
                       {selectedAsset.status}
                     </span>
                   </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-bold mb-3 text-gray-700">Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleStatusChange('trash')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                      selectedAsset.status === 'trash' 
                        ? 'bg-red-600 text-white shadow-inner' 
                        : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                    }`}
                  >
                    <Trash2 size={18} /> Trash
                  </button>
                  <button 
                    onClick={() => handleStatusChange('sorted')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                      selectedAsset.status === 'sorted' 
                        ? 'bg-green-600 text-white shadow-inner' 
                        : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'
                    }`}
                  >
                    <FolderCheck size={18} /> Keep
                  </button>
                </div>
              </div>
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
