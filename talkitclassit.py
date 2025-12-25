const express = require('express');
const path = require('path');

// Import both projects
const talkit = require(path.join(__dirname, 'Keens', 'talkit', 'server.js'));
const classtalk = require(path.join('C:', 'Users', 'Keens', 'classtalk_clone', 'server.js'));

// Create main app
const app = express();

// Mount both projects under different paths
app.use('/talkit', talkit);        // Access talkit at: /talkit/...
app.use('/classtalk', classtalk);  // Access classtalk at: /classtalk/...

// Optional: redirect root to one of them
app.get('/', (req, res) => res.redirect('/talkit'));

// Start one website on a single port
app.listen(3000, () => console.log('Merged website running on port 3000'));
