pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SensorNetwork is ZamaEthereumConfig {
    struct SensorData {
        euint32 encryptedValue;
        uint256 locationHash;
        uint256 timestamp;
        uint32 decryptedValue;
        bool isVerified;
    }

    mapping(string => SensorData) public sensorData;
    string[] public sensorIds;

    event SensorDataCreated(string indexed sensorId, address indexed creator);
    event DecryptionVerified(string indexed sensorId, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {}

    function createSensorData(
        string calldata sensorId,
        externalEuint32 encryptedValue,
        bytes calldata inputProof,
        uint256 locationHash
    ) external {
        require(sensorData[sensorId].timestamp == 0, "Sensor data already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedValue, inputProof)), "Invalid encrypted input");

        sensorData[sensorId] = SensorData({
            encryptedValue: FHE.fromExternal(encryptedValue, inputProof),
            locationHash: locationHash,
            timestamp: block.timestamp,
            decryptedValue: 0,
            isVerified: false
        });

        FHE.allowThis(sensorData[sensorId].encryptedValue);
        FHE.makePubliclyDecryptable(sensorData[sensorId].encryptedValue);

        sensorIds.push(sensorId);
        emit SensorDataCreated(sensorId, msg.sender);
    }

    function verifyDecryption(
        string calldata sensorId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(sensorData[sensorId].timestamp > 0, "Sensor data does not exist");
        require(!sensorData[sensorId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sensorData[sensorId].encryptedValue);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        sensorData[sensorId].decryptedValue = decodedValue;
        sensorData[sensorId].isVerified = true;
        emit DecryptionVerified(sensorId, decodedValue);
    }

    function getEncryptedValue(string calldata sensorId) external view returns (euint32) {
        require(sensorData[sensorId].timestamp > 0, "Sensor data does not exist");
        return sensorData[sensorId].encryptedValue;
    }

    function getSensorData(string calldata sensorId) external view returns (
        uint256 locationHash,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedValue
    ) {
        require(sensorData[sensorId].timestamp > 0, "Sensor data does not exist");
        SensorData storage data = sensorData[sensorId];
        return (data.locationHash, data.timestamp, data.isVerified, data.decryptedValue);
    }

    function getAllSensorIds() external view returns (string[] memory) {
        return sensorIds;
    }

    function aggregateData(string[] calldata sensorIds) external view returns (euint32) {
        require(sensorIds.length > 0, "No sensor IDs provided");
        
        euint32 total = FHE.zero();
        for (uint i = 0; i < sensorIds.length; i++) {
            require(sensorData[sensorIds[i]].timestamp > 0, "Sensor data does not exist");
            total = FHE.add(total, sensorData[sensorIds[i]].encryptedValue);
        }
        return total;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

