# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.2
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

**FHEM Adapter Context:**
This adapter connects ioBroker to FHEM (Freundliche Hausautomation und Energie Messung) systems. FHEM is a GPL'd Perl server for house automation and energy management. The adapter:

- Establishes telnet connections to FHEM servers (default port 7072)
- Synchronizes device states and readings between FHEM and ioBroker
- Supports bidirectional communication for device control
- Manages automatic device discovery and object creation
- Handles FHEM-specific concepts like readings, internals, and attributes
- Provides configuration options for selective synchronization
- Creates smart home device mappings for cloud adapters like Alexa

Key FHEM concepts to understand:
- **Readings**: Current device values/states (temperature, humidity, etc.)
- **Internals**: Internal FHEM device properties and system information
- **Attributes**: Device configuration parameters and metadata
- **Rooms**: FHEM's organization system for grouping devices
- **Dummy devices**: Virtual devices for automation and testing

Connection details:
- Uses telnet protocol for real-time communication
- Sends `jsonlist2` command to retrieve device information
- Listens for FHEM events via `inform on` mechanism
- Supports reconnection handling for network interruptions

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Your tests here
                        const adapterInstance = harness.getAdapterInstance();
                        expect(adapterInstance).toBeDefined();

                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            }).timeout(60000);
        });
    },
});
```

#### Mock Data for FHEM Testing
For FHEM adapter testing, provide mock FHEM responses:

```javascript
// Mock FHEM jsonlist2 response
const mockFhemData = {
  "Results": [
    {
      "Name": "TestDevice",
      "TYPE": "dummy",
      "Readings": {
        "temperature": {
          "Value": "22.5",
          "Time": "2024-01-01 12:00:00"
        }
      },
      "Internals": {
        "room": "TestRoom"
      },
      "Attributes": {
        "alias": "Test Device"
      }
    }
  ]
};
```

#### Testing Framework Notes
- **DO NOT** create your own test structure or try to import/require adapter files directly
- **DO NOT** use custom test runners or frameworks like Mocha/Chai for integration tests
- The `@iobroker/testing` framework handles all adapter lifecycle management
- Tests should focus on adapter behavior, not internal implementation details

## Development Guidelines

### File Structure
- `main.js` - Main adapter entry point
- `lib/` - Helper modules and utilities
- `admin/` - Web interface configuration files
- `test/` - Test files (use `@iobroker/testing` framework)

### Coding Standards
- Use ESLint configuration from `@iobroker/adapter-dev`
- Follow JavaScript ES2018+ standards (Node.js 18+ requirement)
- Use async/await for asynchronous operations
- Implement proper error handling with try/catch blocks

### Adapter Lifecycle
- `ready()` - Initialize adapter, establish connections
- `unload()` - Clean up resources, close connections
- `stateChange()` - Handle state changes from ioBroker
- `objectChange()` - Handle object definition changes

For FHEM adapter specifically:
```javascript
async ready() {
    // Initialize FHEM connection
    this.fhemConnection = new FhemConnection(this.config);
    await this.fhemConnection.connect();
    
    // Subscribe to required states
    this.subscribeStates('*');
}

async unload(callback) {
    try {
        // Close FHEM connection
        if (this.fhemConnection) {
            await this.fhemConnection.disconnect();
        }
        callback();
    } catch (e) {
        callback();
    }
}
```

### State Management
- Use `setState()` for updating device states
- Use `setObject()` for creating/updating device definitions
- Implement proper ACK handling (ack=true for device feedback, ack=false for commands)

### Error Handling
- Log errors with appropriate levels (error, warn, info, debug)
- Implement connection retry mechanisms
- Handle network timeouts gracefully
- Provide meaningful error messages to users

For FHEM connection errors:
```javascript
try {
    await this.fhemConnection.send(command);
} catch (error) {
    this.log.error(`FHEM command failed: ${error.message}`);
    // Attempt reconnection if needed
}
```

### Performance Considerations
- Use connection pooling for multiple FHEM servers
- Implement efficient state synchronization
- Cache frequently accessed data
- Use batch operations when possible

### Security
- Validate all user inputs
- Use secure connection methods when available
- Don't log sensitive information (passwords, tokens)
- Implement proper access control

### Logging Best Practices
- Use appropriate log levels:
  - `error` - Critical errors that affect functionality
  - `warn` - Important issues that don't break functionality  
  - `info` - General operational information
  - `debug` - Detailed information for troubleshooting

For FHEM adapter logging:
```javascript
this.log.info(`Connected to FHEM server at ${this.config.host}:${this.config.port}`);
this.log.debug(`Received FHEM event: ${JSON.stringify(event)}`);
this.log.warn(`FHEM device ${deviceName} not found, creating new object`);
this.log.error(`Failed to connect to FHEM: ${error.message}`);
```

### Configuration
- Use JSON configuration format (adminUI.config: "json")
- Validate configuration parameters
- Provide sensible defaults
- Support both simple and advanced configurations

FHEM adapter configuration structure:
```javascript
"native": {
    "host": "127.0.0.1",
    "port": 7072,
    "reconnectTimeout": 30000,
    "password": "",
    "prompt": "fhem>",
    "syncOptions": {
        "allowedAttributes": "room,alias,comment",
        "autoRole": true,
        "autoRoom": true
    }
}
```

### Documentation
- Maintain clear README.md with setup instructions
- Document all configuration options
- Provide troubleshooting guides
- Include example configurations

### Version Management
- Follow semantic versioning (semver)
- Update version in both `package.json` and `io-package.json`
- Maintain changelog with clear release notes
- Test thoroughly before releases

### Dependencies
- Keep dependencies minimal and up-to-date
- Use `@iobroker/adapter-core` as the primary dependency
- Avoid deprecated packages
- Use official ioBroker tools where available

## FHEM-Specific Implementation Patterns

### Device Synchronization
```javascript
// Parse FHEM jsonlist2 response
function parseDeviceList(jsonResponse) {
    const devices = JSON.parse(jsonResponse);
    
    for (const device of devices.Results) {
        // Create ioBroker objects for each FHEM device
        await this.createDeviceObjects(device);
        
        // Sync current readings
        for (const [reading, data] of Object.entries(device.Readings || {})) {
            await this.setState(`${device.Name}.${reading}`, {
                val: data.Value,
                ack: true,
                ts: new Date(data.Time).getTime()
            });
        }
    }
}
```

### Event Handling
```javascript
// Handle FHEM events
function handleFhemEvent(eventData) {
    const [timestamp, deviceName, reading, value] = eventData.split(' ');
    
    const stateId = `${deviceName}.${reading}`;
    this.setState(stateId, {
        val: value,
        ack: true,
        ts: parseInt(timestamp) * 1000
    });
}
```

### Command Sending
```javascript
// Send commands to FHEM
async function sendFhemCommand(deviceName, command, value) {
    const fhemCommand = `set ${deviceName} ${command} ${value}`;
    
    try {
        await this.fhemConnection.send(fhemCommand);
        this.log.debug(`Sent FHEM command: ${fhemCommand}`);
    } catch (error) {
        this.log.error(`Failed to send FHEM command: ${error.message}`);
        throw error;
    }
}
```

## Code Generation Guidelines

When generating code for ioBroker adapters:

1. **Always** use the adapter instance context (`this.log`, `this.setState`, etc.)
2. **Always** implement proper error handling with try/catch blocks
3. **Always** use async/await for asynchronous operations
4. **Always** validate inputs and handle edge cases
5. **Always** follow ioBroker naming conventions for states and objects
6. **Never** use deprecated APIs or patterns
7. **Never** block the event loop with synchronous operations
8. **Never** ignore errors or fail silently

### Example Code Generation
```javascript
// Good: Proper ioBroker adapter pattern
async createDevice(deviceInfo) {
    try {
        const deviceId = this.namespace + '.' + deviceInfo.name;
        
        // Create device object
        await this.setObjectAsync(deviceId, {
            type: 'device',
            common: {
                name: deviceInfo.alias || deviceInfo.name,
                role: 'device'
            },
            native: deviceInfo
        });
        
        // Create state objects for readings
        for (const [reading, data] of Object.entries(deviceInfo.readings || {})) {
            await this.setObjectAsync(deviceId + '.' + reading, {
                type: 'state',
                common: {
                    name: reading,
                    type: this.getDataType(data.Value),
                    role: this.getRoleFromReading(reading),
                    read: true,
                    write: false
                },
                native: {}
            });
        }
        
        this.log.info(`Created device: ${deviceInfo.name}`);
    } catch (error) {
        this.log.error(`Failed to create device ${deviceInfo.name}: ${error.message}`);
        throw error;
    }
}
```

For FHEM adapter specifically, always consider:
- FHEM device types and their capabilities
- Reading/Internal/Attribute synchronization
- Room assignments and organization
- Automatic object creation vs. manual configuration
- Telnet connection stability and reconnection
- FHEM command syntax and response handling

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

This ensures that generated code follows ioBroker best practices and integrates properly with the adapter framework.
