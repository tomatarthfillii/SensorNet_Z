import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SensorData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
  location: string;
  sensorType: string;
}

interface NetworkStats {
  totalSensors: number;
  activeSensors: number;
  dataPoints: number;
  encryptedBytes: number;
  avgTemperature: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [sensors, setSensors] = useState<SensorData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSensor, setCreatingSensor] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSensorData, setNewSensorData] = useState({ 
    name: "", 
    value: "", 
    location: "", 
    sensorType: "temperature",
    description: "" 
  });
  const [selectedSensor, setSelectedSensor] = useState<SensorData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats>({
    totalSensors: 0,
    activeSensors: 0,
    dataPoints: 0,
    encryptedBytes: 0,
    avgTemperature: 0
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const sensorsList: SensorData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          sensorsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            location: `Node ${businessId.split('-')[1] || 'Unknown'}`,
            sensorType: ['temperature', 'humidity', 'pressure'][Math.floor(Math.random() * 3)]
          });
        } catch (e) {
          console.error('Error loading sensor data:', e);
        }
      }
      
      setSensors(sensorsList);
      updateNetworkStats(sensorsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateNetworkStats = (sensorList: SensorData[]) => {
    const totalSensors = sensorList.length;
    const activeSensors = sensorList.filter(s => Date.now()/1000 - s.timestamp < 3600).length;
    const dataPoints = sensorList.reduce((sum, s) => sum + s.publicValue1, 0);
    const encryptedBytes = sensorList.length * 256;
    const avgTemperature = sensorList.length > 0 ? sensorList.reduce((sum, s) => sum + s.publicValue1, 0) / sensorList.length : 0;

    setNetworkStats({
      totalSensors,
      activeSensors,
      dataPoints,
      encryptedBytes,
      avgTemperature
    });
  };

  const createSensor = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSensor(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating sensor with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const sensorValue = parseInt(newSensorData.value) || 0;
      const businessId = `sensor-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, sensorValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSensorData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        sensorValue,
        0,
        newSensorData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Sensor data encrypted and stored!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSensorData({ name: "", value: "", location: "", sensorType: "temperature", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSensor(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSensors = sensors.filter(sensor => {
    const matchesSearch = sensor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sensor.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === "all" || sensor.sensorType === filterType;
    return matchesSearch && matchesFilter;
  });

  const renderNetworkDashboard = () => {
    return (
      <div className="dashboard-grid">
        <div className="stat-card neon-blue">
          <div className="stat-icon">📡</div>
          <div className="stat-content">
            <h3>Total Sensors</h3>
            <div className="stat-value">{networkStats.totalSensors}</div>
            <div className="stat-label">FHE Nodes</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Active Nodes</h3>
            <div className="stat-value">{networkStats.activeSensors}</div>
            <div className="stat-label">Online Now</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">🔒</div>
          <div className="stat-content">
            <h3>Encrypted Data</h3>
            <div className="stat-value">{networkStats.encryptedBytes}MB</div>
            <div className="stat-label">FHE Protected</div>
          </div>
        </div>
        
        <div className="stat-card neon-purple">
          <div className="stat-icon">🌡️</div>
          <div className="stat-content">
            <h3>Avg Reading</h3>
            <div className="stat-value">{networkStats.avgTemperature.toFixed(1)}°C</div>
            <div className="stat-label">Network Average</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Sensor Encryption</h4>
            <p>Environmental data encrypted with Zama FHE at source</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Gateway Aggregation</h4>
            <p>Encrypted data aggregated without decryption</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Compute</h4>
            <p>FHE operations on encrypted data streams</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Secure Output</h4>
            <p>Final results revealed with privacy intact</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🌐</div>
            <h1>SensorNet_Z</h1>
            <span className="tagline">FHE-Powered Privacy Sensor Network</span>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </header>
        
        <div className="connection-screen">
          <div className="connection-hero">
            <div className="hero-graphic">
              <div className="network-node"></div>
              <div className="network-node"></div>
              <div className="network-node"></div>
              <div className="encryption-core">🔐</div>
            </div>
            <h2>Connect to Privacy-First Sensor Network</h2>
            <p>Zero-knowledge environmental monitoring with fully homomorphic encryption</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">🛡️</div>
                <h4>Location Privacy</h4>
                <p>Sensor locations never exposed</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <h4>Real-time FHE</h4>
                <p>Encrypted data processing</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🌍</div>
                <h4>Global Network</h4>
                <p>Decentralized sensor grid</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-loader">
          <div className="encryption-ring"></div>
          <div className="data-stream"></div>
        </div>
        <h3>Initializing FHE Environment</h3>
        <p>Setting up encrypted computation engine...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="sensor-pulse"></div>
      <p>Connecting to Sensor Network...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🌐</div>
          <div className="logo-text">
            <h1>SensorNet_Z</h1>
            <span className="tagline">FHE Privacy Sensor Network</span>
          </div>
        </div>
        
        <nav className="main-nav">
          <button className="nav-btn active">Dashboard</button>
          <button className="nav-btn">Network Map</button>
          <button className="nav-btn">Analytics</button>
        </nav>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">Test FHE</button>
          <button onClick={() => setShowCreateModal(true)} className="add-sensor-btn">
            + Add Sensor
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>Network Overview</h2>
            <div className="header-controls">
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "⟳"} Refresh
              </button>
            </div>
          </div>
          
          {renderNetworkDashboard()}
          
          <div className="fhe-info-panel">
            <h3>FHE Data Pipeline</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="sensors-section">
          <div className="section-header">
            <h2>Sensor Nodes</h2>
            <div className="filters">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search sensors..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="search-icon">🔍</span>
              </div>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">All Types</option>
                <option value="temperature">Temperature</option>
                <option value="humidity">Humidity</option>
                <option value="pressure">Pressure</option>
              </select>
            </div>
          </div>
          
          <div className="sensors-grid">
            {filteredSensors.length === 0 ? (
              <div className="no-sensors">
                <div className="no-data-icon">📡</div>
                <p>No sensor nodes found</p>
                <button onClick={() => setShowCreateModal(true)} className="cta-btn">
                  Deploy First Sensor
                </button>
              </div>
            ) : (
              filteredSensors.map((sensor, index) => (
                <div 
                  key={sensor.id}
                  className={`sensor-card ${sensor.sensorType} ${sensor.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedSensor(sensor)}
                >
                  <div className="sensor-header">
                    <div className="sensor-type-icon">
                      {sensor.sensorType === 'temperature' ? '🌡️' : 
                       sensor.sensorType === 'humidity' ? '💧' : '📊'}
                    </div>
                    <div className="sensor-status">
                      <span className={`status-dot ${sensor.isVerified ? 'online' : 'offline'}`}></span>
                      {sensor.isVerified ? 'Verified' : 'Encrypted'}
                    </div>
                  </div>
                  
                  <h3 className="sensor-name">{sensor.name}</h3>
                  <p className="sensor-location">{sensor.location}</p>
                  
                  <div className="sensor-data">
                    <div className="data-value">
                      {sensor.isVerified ? 
                        `${sensor.decryptedValue}°C` : 
                        '🔒 Encrypted'
                      }
                    </div>
                    <div className="data-label">Current Reading</div>
                  </div>
                  
                  <div className="sensor-meta">
                    <span>{new Date(sensor.timestamp * 1000).toLocaleDateString()}</span>
                    <span>{sensor.sensorType}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      
      {showCreateModal && (
        <CreateSensorModal 
          onSubmit={createSensor} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSensor} 
          sensorData={newSensorData} 
          setSensorData={setNewSensorData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedSensor && (
        <SensorDetailModal 
          sensor={selectedSensor} 
          onClose={() => setSelectedSensor(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSensor.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-icon">
            {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
            {transactionStatus.status === "success" && "✓"}
            {transactionStatus.status === "error" && "✗"}
          </div>
          <div className="toast-message">{transactionStatus.message}</div>
        </div>
      )}
    </div>
  );
};

const CreateSensorModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  sensorData: any;
  setSensorData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, sensorData, setSensorData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSensorData({ ...sensorData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Deploy New Sensor</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="encryption-badge">FHE ENCRYPTED</div>
            <p>All sensor readings are encrypted with Zama FHE before transmission</p>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Sensor Name *</label>
              <input 
                type="text" 
                name="name" 
                value={sensorData.name} 
                onChange={handleChange} 
                placeholder="Enter sensor name..." 
              />
            </div>
            
            <div className="form-group">
              <label>Sensor Type *</label>
              <select name="sensorType" value={sensorData.sensorType} onChange={handleChange}>
                <option value="temperature">Temperature</option>
                <option value="humidity">Humidity</option>
                <option value="pressure">Pressure</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Reading Value (Integer) *</label>
              <input 
                type="number" 
                name="value" 
                value={sensorData.value} 
                onChange={handleChange} 
                placeholder="Enter sensor reading..." 
                step="1"
              />
              <div className="input-hint">FHE Encrypted Integer</div>
            </div>
            
            <div className="form-group">
              <label>Location</label>
              <input 
                type="text" 
                name="location" 
                value={sensorData.location} 
                onChange={handleChange} 
                placeholder="Sensor location..." 
              />
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description" 
                value={sensorData.description} 
                onChange={handleChange} 
                placeholder="Sensor description..." 
                rows={3}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !sensorData.name || !sensorData.value} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting Data..." : "Deploy Sensor"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SensorDetailModal: React.FC<{
  sensor: SensorData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ sensor, onClose, isDecrypting, decryptData }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (sensor.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setLocalDecrypted(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Sensor Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="sensor-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{sensor.name}</strong>
            </div>
            <div className="info-row">
              <span>Type:</span>
              <span className={`type-badge ${sensor.sensorType}`}>
                {sensor.sensorType}
              </span>
            </div>
            <div className="info-row">
              <span>Location:</span>
              <span>{sensor.location}</span>
            </div>
            <div className="info-row">
              <span>Deployed:</span>
              <span>{new Date(sensor.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <span className="address">{sensor.creator.substring(0, 8)}...{sensor.creator.substring(36)}</span>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            <div className="encryption-status">
              <div className={`status ${sensor.isVerified ? 'verified' : 'encrypted'}`}>
                {sensor.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
              </div>
              
              <div className="data-display">
                <div className="value">
                  {sensor.isVerified ? 
                    `${sensor.decryptedValue}°C` : 
                    localDecrypted ? 
                    `${localDecrypted}°C (Local)` : 
                    '🔐 Encrypted Integer'
                  }
                </div>
                <div className="value-label">Current Reading</div>
              </div>
              
              {!sensor.isVerified && (
                <button 
                  onClick={handleDecrypt}
                  disabled={isDecrypting}
                  className="decrypt-btn"
                >
                  {isDecrypting ? "Decrypting..." : "Verify Decryption"}
                </button>
              )}
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{sensor.description || "No description provided."}</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!sensor.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="primary-btn"
            >
              {isDecrypting ? "Processing..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

