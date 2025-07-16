// n8n Binary Data Access - Fixed Binary File Creation
console.log('=== Fixed Binary File Creation ===');

// Helper function to safely get property values
function safeGet(obj, property, defaultValue = '') {
  return obj && obj[property] !== undefined && obj[property] !== null ? obj[property] : defaultValue;
}

// Initialize variables
let binaryData = null;
let imageSize = 0;
let method = 'none';
let debugInfo = {};

// Try to access binary data using n8n's methods
try {
  // Check if helpers are available
  if (!this.helpers) {
    throw new Error('this.helpers not available');
  }
  
  console.log('Available helper methods:', Object.keys(this.helpers));
  
  // Method 1: Try to get binary data using getBinaryDataBuffer
  if (typeof this.helpers.getBinaryDataBuffer === 'function') {
    console.log('Trying getBinaryDataBuffer...');
    
    // Try different binary property names
    const possibleNames = ['imageData', 'data', 'image', 'file', 'binary'];
    
    for (const name of possibleNames) {
      try {
        console.log(`Trying getBinaryDataBuffer(0, '${name}')...`);
        const buffer = await this.helpers.getBinaryDataBuffer(0, name);
        
        if (buffer && Buffer.isBuffer(buffer)) {
          binaryData = buffer;
          imageSize = binaryData.length;
          method = `getBinaryDataBuffer-${name}`;
          console.log(`Found binary data using getBinaryDataBuffer('${name}'), length:`, imageSize);
          debugInfo.foundIn = `getBinaryDataBuffer('${name}')`;
          break;
        }
      } catch (error) {
        console.log(`getBinaryDataBuffer('${name}') failed:`, error.message);
      }
    }
  }
  
  // Method 2: Try to get binary data using getBinaryData
  if (!binaryData && typeof this.helpers.getBinaryData === 'function') {
    console.log('Trying getBinaryData...');
    
    try {
      const binaryInfo = await this.helpers.getBinaryData(0, 'imageData');
      console.log('getBinaryData result:', binaryInfo);
      
      if (binaryInfo && binaryInfo.data && Buffer.isBuffer(binaryInfo.data)) {
        binaryData = binaryInfo.data;
        imageSize = binaryData.length;
        method = 'getBinaryData';
        console.log('Found binary data using getBinaryData, length:', imageSize);
        debugInfo.foundIn = 'getBinaryData';
      }
    } catch (error) {
      console.log('getBinaryData failed:', error.message);
    }
  }
  
  // Method 3: Try to access binary data directly from $binary
  if (!binaryData && $binary) {
    console.log('Trying direct $binary access...');
    
    // Look for any Buffer in $binary
    for (const key in $binary) {
      const value = $binary[key];
      if (Buffer.isBuffer(value)) {
        binaryData = value;
        imageSize = binaryData.length;
        method = `binary-${key}-direct`;
        console.log(`Found Buffer in $binary.${key}, length:`, imageSize);
        debugInfo.foundIn = `binary.${key} (direct)`;
        break;
      }
    }
  }
  
  if (!binaryData) {
    throw new Error('No binary data found using any method');
  }
  
} catch (error) {
  console.error('Failed to access binary data:', error.message);
  debugInfo.accessError = error.message;
}

// Create a proper n8n binary file if we have data
if (binaryData) {
  try {
    // Try different approaches to create the binary file
    
    // Approach 1: Try setBinaryDataBuffer with proper options
    if (typeof this.helpers.setBinaryDataBuffer === 'function') {
      console.log('Trying setBinaryDataBuffer...');
      
      try {
        await this.helpers.setBinaryDataBuffer(binaryData, {
          mimeType: 'image/png',
          fileName: 'processed-image.png'
        });
        
        console.log('Successfully created n8n binary file using setBinaryDataBuffer');
        debugInfo.binaryFileCreated = true;
        debugInfo.method = 'setBinaryDataBuffer';
        
      } catch (setError) {
        console.log('setBinaryDataBuffer failed:', setError.message);
        debugInfo.setBinaryDataBufferError = setError.message;
        
        // Approach 2: Try setBinaryData
        if (typeof this.helpers.setBinaryData === 'function') {
          console.log('Trying setBinaryData...');
          
          try {
            await this.helpers.setBinaryData(binaryData, {
              mimeType: 'image/png',
              fileName: 'processed-image.png'
            });
            
            console.log('Successfully created n8n binary file using setBinaryData');
            debugInfo.binaryFileCreated = true;
            debugInfo.method = 'setBinaryData';
            
          } catch (setDataError) {
            console.log('setBinaryData failed:', setDataError.message);
            debugInfo.setBinaryDataError = setDataError.message;
            
            // Approach 3: Try to create binary data using a different method
            console.log('Trying alternative binary creation...');
            
            // Since we have the buffer, we can pass it through and let the HTTP Request node handle it
            // by creating a binary property that n8n can recognize
            debugInfo.alternativeApproach = 'pass-through-buffer';
          }
        }
      }
    }
    
  } catch (binaryError) {
    console.error('Failed to create binary file:', binaryError.message);
    debugInfo.binaryFileError = binaryError.message;
  }
}

// Return the result with comprehensive debug info
return {
  // Original data for reference
  tweetText: safeGet($json, 'tweetText'),
  thumbnailUrl: safeGet($json, 'thumbnailUrl'),
  storeName: safeGet($json, 'storeName'),
  productTitle: safeGet($json, 'productTitle'),
  productUrl: safeGet($json, 'productUrl'),
  refererDomain: safeGet($json, 'refererDomain'),
  
  // Status info
  hasImage: binaryData !== null,
  imageSize: imageSize,
  method: method,
  uploadError: binaryData === null ? 'Could not access binary data' : null,
  
  // Debug info
  debug: debugInfo,
  bufferLength: binaryData ? binaryData.length : 0,
  bufferType: binaryData ? typeof binaryData : 'null',
  isBuffer: binaryData ? Buffer.isBuffer(binaryData) : false,
  
  // Raw data for inspection
  jsonKeys: $json ? Object.keys($json) : [],
  binaryKeys: $binary ? Object.keys($binary) : []
}; 