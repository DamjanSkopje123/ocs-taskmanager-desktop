// Code signing script for Windows
// This script is called by electron-builder during the build process
// If no certificate is provided, it will skip signing and build unsigned

exports.default = async function(configuration) {
  // Only sign if certificate is provided
  if (process.env.WIN_CERTIFICATE_FILE && process.env.WIN_CERTIFICATE_PASSWORD) {
    console.log('🔐 Code signing certificate detected.');
    console.log(`📄 Certificate: ${process.env.WIN_CERTIFICATE_FILE}`);
    console.log('💡 electron-builder will sign the application automatically.');
    
    const fs = require('fs');
    const path = require('path');
    const certPath = path.resolve(process.env.WIN_CERTIFICATE_FILE);
    
    if (!fs.existsSync(certPath)) {
      console.error(`❌ Certificate file not found: ${certPath}`);
      console.warn('⚠️  Building unsigned application (certificate not found)');
      return;
    }
    
    // Return configuration for electron-builder to handle signing
    return {
      certificateFile: certPath,
      certificatePassword: process.env.WIN_CERTIFICATE_PASSWORD
    };
  } else {
    console.warn('⚠️  No code signing certificate found. Building unsigned application.');
    console.warn('⚠️  Windows SmartScreen will show a warning for unsigned apps.');
    console.warn('💡 To sign your app, set WIN_CERTIFICATE_FILE and WIN_CERTIFICATE_PASSWORD environment variables.');
    console.warn('💡 See CODE_SIGNING_GUIDE.md for instructions.');
    // Return nothing to skip signing
    return;
  }
};

