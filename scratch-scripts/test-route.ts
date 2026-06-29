async function run() {
  const res = await fetch('http://localhost:3000/api/test-profile');
  console.log(res.status);
  console.log(await res.text());
}
run();
