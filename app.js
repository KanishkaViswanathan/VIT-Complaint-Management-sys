// Load modules
const express = require('express');
const AWS = require('aws-sdk');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config(); // Load environment variables

const app = express();
const port = 1337;

// AWS SDK configuration
AWS.config.update({
    accessKeyId: '', // Replace with your access key ID
    secretAccessKey: '', // Replace with your secret access key
    region: 'ap-south-1' // Replace with your AWS region
});

// DynamoDB instance
const dynamodb = new AWS.DynamoDB.DocumentClient();

// SNS instance
const sns = new AWS.SNS();

// Set table names
const COMPLAINT_TABLE = 'Complaints'; // DynamoDB table for complaints
const USER_TABLE = 'Users'; // DynamoDB table for users

// Middleware to parse request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS middleware
app.use(cors());

// Session setup for user authentication
app.use(session({
    secret: 'yourFallbackSecretKey',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS in production
}));

// Serve static files
app.use(express.static(__dirname, {
    complaint: false // Disable automatic serving of complaint.html as default
}));

// Route to serve index.html by default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route to serve the signup page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});

// Handle signup form submission
app.post('/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        // Store user in DynamoDB
        const params = {
            TableName: USER_TABLE,
            Item: {
                username: username,
                password: hashedPassword
            }
        };

        await dynamodb.put(params).promise();
        res.redirect('/');
    } catch (err) {
        console.error('Error during signup:', err);
        res.status(500).send('Error during signup.');
    }
});

// Handle login form submission
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Retrieve user from DynamoDB
        const params = {
            TableName: USER_TABLE,
            Key: {
                username: username
            }
        };

        const data = await dynamodb.get(params).promise();
        const user = data.Item;

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.username;
            res.redirect('/main');
        } else {
            res.redirect('/?error=1');
        }
    } catch (err) {
        console.error('Error during login:', err);
        res.status(500).send('Error during login.');
    }
});

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/');
    }
}

// Protect the main page route
app.get('/main', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'complaint.html'));
});

// Send notification via SNS
async function sendSNSNotification(message) {
    const params = {
        Message: message,  // The message to send
        TopicArn: 'arn:aws:sns:ap-south-1:783764592627:Complaint' // Your SNS Topic ARN (replace with your actual ARN)
    };

    try {
        const result = await sns.publish(params).promise();
        console.log('SNS Notification sent successfully:', result);
    } catch (err) {
        console.error('Error sending SNS notification:', err);
    }
}

// Submit complaint
app.post('/submit-complaint', isAuthenticated, async (req, res) => {
    try {
        const { registrationId, type, complaintText } = req.body;
        const complaintNumber = `C-${Date.now()}`;

        // Create a new complaint in DynamoDB
        const params = {
            TableName: COMPLAINT_TABLE,
            Item: {
                registrationId,
                type,
                complaintText,
                complaintNumber,
                createdAt: new Date().toISOString()
            }
        };

        // Save complaint to DynamoDB
        await dynamodb.put(params).promise();

        // Send SNS Notification
        const message = `A new complaint has been submitted. Complaint Number: ${complaintNumber}. Type: ${type}.`;
        await sendSNSNotification(message);

        // Respond with the complaint number
        res.status(201).json({ success: true, complaintNumber });
    } catch (err) {
        console.error('Error saving complaint:', err);
        res.status(500).send('Failed to submit complaint');
    }
});

// Example route to handle file upload to S3
app.post('/upload', isAuthenticated, async (req, res) => {
    try {
        const fileContent = req.body.fileContent; // Adjust based on your frontend file handling
        const fileName = `uploads/${Date.now()}-file.txt`;

        const s3 = new AWS.S3();
        const uploadParams = {
            Bucket: 'complaint1', // Bucket name
            Key: fileName, // File name you want to save as in S3
            Body: fileContent
        };

        const data = await s3.upload(uploadParams).promise();
        res.status(200).json({ success: true, fileUrl: data.Location });
    } catch (err) {
        console.error('Error uploading file to S3:', err);
        res.status(500).send('Failed to upload file');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is active on port ${port}`);
});
