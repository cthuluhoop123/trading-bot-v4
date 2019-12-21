const request = require('superagent');
const Throttle = require('superagent-throttle');
const throttle = new Throttle({
    active: true,
    rate: 1,
    ratePer: 10,
    concurrent: 1
});

for (let i = 0; i < 100; i++) {
    request
        .get('www.google.com')
        .use(throttle.plugin())
        .then(() => {
            console.log('google');
        });
}
