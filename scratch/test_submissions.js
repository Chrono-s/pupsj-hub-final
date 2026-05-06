async function testSubmissions() {
  // Login as student
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@pupsj.edu.ph', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;

  if (!token) {
    console.error('Failed to login:', loginData);
    return;
  }
  console.log('Logged in successfully');

  // First submission
  console.log('--- FIRST SUBMISSION ---');
  let fd1 = new FormData();
  fd1.append('type', 'lost');
  fd1.append('item_name', 'First Test Item');
  fd1.append('description', 'This is the first test item');
  fd1.append('category', 'Personal Items');

  try {
    const res1 = await fetch('http://localhost:3000/api/lost-found', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: fd1
    });
    const data1 = await res1.json();
    console.log('Status 1:', res1.status);
    console.log('Response 1:', data1);
  } catch (err) {
    console.error('Fetch error 1:', err);
  }

  // Second submission
  console.log('--- SECOND SUBMISSION ---');
  let fd2 = new FormData();
  fd2.append('type', 'lost');
  fd2.append('item_name', 'Second Test Item');
  fd2.append('description', 'This is the second test item');
  fd2.append('category', 'Personal Items');

  try {
    const res2 = await fetch('http://localhost:3000/api/lost-found', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: fd2
    });
    const data2 = await res2.json();
    console.log('Status 2:', res2.status);
    console.log('Response 2:', data2);
  } catch(err) {
     console.error('Fetch error 2:', err);
  }
}

testSubmissions().catch(console.error);