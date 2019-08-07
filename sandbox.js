require('dotenv').config();

const fs = require('fs');

const Backpacktf = require('./backpacktf.js');
const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN);
const partnerId = '76561198853853135';

async function main() {
    const reputation = await backpacktf.checkReputation(partnerId);
    console.log(reputation.users);
    console.log(reputation.users[partnerId].bans && reputation.users[partnerId].bans.steamrep_scammer);
} main();
