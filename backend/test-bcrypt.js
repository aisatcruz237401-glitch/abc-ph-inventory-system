const bcrypt = require('bcryptjs');

const password = 'Staff@12345';
const hash = '$2a$10$mrgt5OfBYZOkbt3gMPA.wukF6HYg08Kc3xrhtyy826etqACQc4Xnq';

bcrypt.compare(password, hash).then(result => {
  console.log('Password matches:', result);
});