const Promise = require('bluebird');
const path = require('path');
const camelCase = require('camelcase');
const requireDir = require('require-dir');
const fs = Promise.promisifyAll(require('fs-extra'));
const mustache = require('mustache');
const child_process = Promise.promisifyAll(require('child_process'));
const vagrant = Promise.promisifyAll(require('node-vagrant'));
const scp2 = require('scp2');
const ssh2 = require('ssh2');
const Client = require('ssh2').Client;
const prompt = require('prompt');
const chalk = require('chalk');
const validator = require('validator');
const yaml = require('js-yaml');
const slash = require('slash');
const git = require('simple-git');
const ora = require('ora');
const hasbin = require('hasbin');
const drivelist = Promise.promisifyAll(require('drivelist'));
require('console.table');

const boxes = path.join(require('os').homedir(), '.baker');
const ansible = path.join(boxes, 'ansible-srv');
const configPath = path.join(__dirname, './config');
const bakerletsPath = path.join(__dirname, './lib/bakerlets');
const remotesPath = path.join(__dirname, './remotes');


const spinnerDot = 'dots';

// External dependencies to pass to the commands
let dep = {
    path,
    child_process,
    process,
    fs,
    Promise,
    vagrant,
    scp2,
    ssh2,
    Client,
    prompt,
    chalk,
    mustache,
    validator,
    yaml,
    slash,
    prompt,
    git,
    ora,
    hasbin,
    spinnerDot,
    boxes,
    ansible,
    configPath,
    bakerletsPath,
    remotesPath,
    drivelist
};

// Internal dependencies
const inDepFns = requireDir(path.join(__dirname, 'lib', 'modules'));

let temp = {}; // TODO: This might be too hacky, find a better way
Object.keys(inDepFns).forEach(name => {
    temp[camelCase(name)] = inDepFns[name](dep);
});

Object.keys(inDepFns).forEach(name => {
    dep[camelCase(name)] = inDepFns[name](Object.assign(temp, dep));
});

// Load commands from folder and pass dependencies
const commandsFn = requireDir(path.join(__dirname, 'lib', 'commands'));
const commands = Object.keys(commandsFn).map(i => commandsFn[i](dep));

// Export commands and modules separatelly
module.exports = { commands, modules: dep };
