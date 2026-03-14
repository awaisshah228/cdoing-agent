const request = require('supertest');
const app = require('./server');

describe('Express Server', () => {
  describe('GET /', () => {
    it('should return a greeting message', async () => {
      const res = await request(app).get('/');
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'Hello, World!' });
    });
  });

  describe('GET /api/users', () => {
    it('should return a list of users', async () => {
      const res = await request(app).get('/api/users');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual({ id: 1, name: 'Alice' });
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({ name: 'Charlie' });
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ id: 3, name: 'Charlie' });
    });

    it('should return 400 if name is missing', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({});
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Name is required' });
    });
  });
});
