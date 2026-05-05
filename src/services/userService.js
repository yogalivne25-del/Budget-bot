const prisma = require('../db');

async function findOrCreateUser(phone) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone } });
  }
  return user;
}

async function setUserName(phone, name) {
  return prisma.user.update({ where: { phone }, data: { name } });
}

async function getUserByToken(token) {
  return prisma.user.findUnique({ where: { dashboardToken: token } });
}

module.exports = { findOrCreateUser, setUserName, getUserByToken };
