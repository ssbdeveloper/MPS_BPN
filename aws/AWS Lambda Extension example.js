// Use Secrets Manager in a Lambda function with AWS-Parameters-and-Secrets-Lambda-Extension lambda layer extension
// https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
import http from 'http';
export const handler = async (event) => {
    try {
        const options = {
            hostname: 'localhost',
            port: 2773,
            path: '/secretsmanager/get?secretId=ssb/sapcpi/mps',
            headers: {
                'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN
            }
        };
        const response = await new Promise((resolve, reject) => { 
            http.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        body: data
                    });
                });
            }).on('error', reject);
        });
        const secret = JSON.parse(response.body).SecretString;
        // Your code goes here

        return {
            statusCode: response.statusCode,
            body: JSON.stringify({ 
                message: 'Successfully retrieved secret',
                secretRetrieved: true 
            })
        };

    } catch(error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error retrieving secret',
                error: error.message
            })
        };
    }
};