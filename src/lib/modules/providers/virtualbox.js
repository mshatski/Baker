const Promise       =      require('bluebird');
const child_process =      Promise.promisifyAll(require('child_process'));
const conf          =      require('../configstore');
const fs            =      require('fs-extra');
const mustache      =      require('mustache');
const path          =      require('path');
const print         =      require('../print');
const Provider      =      require('./provider');
const slash         =      require('slash')
const spinner       =      require('../spinner');
const Ssh           =      require('../ssh');
const Utils         =      require('../utils/utils');
const vagrant       =      Promise.promisifyAll(require('node-vagrant'));

const vbox          =      require('node-virtualbox');
const VBoxProvider  =      require('node-virtualbox/lib/VBoxProvider');
const private_key   =      require.resolve('node-virtualbox/config/resources/insecure_private_key');

const yaml          =      require('js-yaml');
const spinnerDot    =      conf.get('spinnerDot');

const _             =      require('underscore');

const {ansible, boxes, bakeletsPath, remotesPath, configPath} = require('../../../global-vars');

class VirtualBoxProvider extends Provider {
    constructor() {
        super();

        this.driver = new VBoxProvider();
    }

    /**
     * Prune
     */
    static async prune() {
    }

    async list() {
        try {
            let VMs = await vagrant.globalStatusAsync();
            // Only showing baker VMs
            VMs = VMs.filter(VM => VM.cwd.includes('.baker/'));
            console.table('\nBaker status: ', VMs);
        } catch (err) {
            throw err
        }
        return;
    }

    /**
     * Starts a VM by name
     * @param {String} VMName Name of the VM to be started
     * @param {boolean} verbose
     */
    async start(VMName, verbose = false) {
        await vbox({start: true, vmname: doc.name, syncs: [], verbose: true});
    }

    /**
     * Shut down a VM by name
     * @param {String} VMName Name of the VM to be halted
     * TODO: add force option
     */
    async stop(VMName, force = false) {
        await vbox({stopCmd: true, vmname: doc.name, syncs: [], verbose: true});
    }

    /**
     * Destroy VM
     * @param {String} VMName
     */
    async delete(VMName) {
        await vbox({deleteCmd: true, vmname: doc.name, syncs: [], verbose: true});
    }

    /**
     * Get ssh configurations
     * @param {Obj} machine
     * @param {Obj} nodeName Optionally give name of machine when multiple machines declared in single Vagrantfile.
     */
    async getSSHConfig(machine, nodeName) {

        // Use VirtualBox driver
        let vmInfo = await this.driver.info(machine);
        let port = null;
        if( vmInfo.hasOwnProperty('Forwarding(0)') )
        {
          port = parseInt( vmInfo['Forwarding(0)'].split(',')[3]);
        }
        return {user: 'vagrant', port: port, host: machine, hostname: '127.0.0.1', private_key: private_key};
    }

    /**
     * Returns State of a VM
     * @param {String} VMName
     */
    static async getState(VMName) {
        let vmInfo = await this.driver.info(doc.name);
        return vmInfo.VMState.replace('"','');
    }

    /**
     * It will ssh to the vagrant box
     * @param {String} name
     */
    async ssh(name) {
        try {
            let info = await this.getSSHConfig(name);
            // hack
            let key = path.join(require('os').tmpdir(), `${name}-key`);
            fs.copyFileSync(info.private_key, key );
            fs.chmod(key, "600");

            child_process.execSync(`ssh -i ${key} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -p ${info.port} ${info.user}@127.0.0.1`, {stdio: ['inherit', 'inherit', 'ignore']});
        } catch(err) {
            throw err;
        }
    }

    // also in servers.js
    /**
     * Adds inventory
     *
     * @param {String} ip
     * @param {String} name
     * @param {Object} sshConfig
     */
    async addToAnsibleHosts(ip, name, ansibleSSHConfig, vmSSHConfig) {
        // TODO: Consider also specifying ansible_connection=${} to support containers etc.
        // TODO: Callers of this can be refactored to into two methods, below:
        return Ssh.sshExec(`echo "[${name}]\n${ip}\tansible_ssh_private_key_file=${ip}_rsa\tansible_user=${vmSSHConfig.user}" > /home/vagrant/baker/${name}/baker_inventory && ansible all -i "localhost," -m lineinfile -a "dest=/etc/hosts line='${ip} ${name}' state=present" -c local --become`, ansibleSSHConfig);
    }

    async bake(scriptPath, ansibleSSHConfig, verbose) {
        let doc = yaml.safeLoad(await fs.readFile(path.join(scriptPath, 'baker.yml'), 'utf8'));

        let dir = path.join(boxes, doc.name);

        try {
            await fs.ensureDir(dir);
        } catch (err) {
            throw `Creating directory failed: ${dir}`;
        }

        let vms = await this.driver.list();
        let vm = _.findWhere( vms, {name: doc.name} );
        if( !vm )
        {
            // Create VM
            console.log( "Creating vm. ")
            await vbox({provision: true, ip: doc.vm.ip, vmname: doc.name, syncs: [], verbose: true});
        }
        let vmInfo = await this.driver.info(doc.name);
        console.log( `VM is currently in state ${vmInfo.VMState}`)
        if( vmInfo.VMState != '"running"' )
        {
            await vbox({start: true, vmname: doc.name, verbose: true});

            // todo: basic ssh check to make sure ready.
        }

        let sshConfig = await this.getSSHConfig(doc.name);

        //console.log( ansibleSSHConfig, sshConfig);

        let ip = doc.vm.ip;
        await Ssh.copyFromHostToVM(
            sshConfig.private_key,
            `/home/vagrant/baker/${doc.name}/${ip}_rsa`,
            ansibleSSHConfig
        );

        //TODO: temperary for bakerformac PoC
        await Ssh.copyFromHostToVM(
            path.join(configPath, 'common', 'registerhost.yml'),
            `/home/vagrant/baker/registerhost.yml`,
            ansibleSSHConfig
        );

        await this.addToAnsibleHosts(ip, doc.name, ansibleSSHConfig, sshConfig)
        await this.setKnownHosts(ip, ansibleSSHConfig);
        await this.mkTemplatesDir(doc, ansibleSSHConfig);

        // prompt for passwords
        if( doc.vars )
        {
            await this.traverse(doc.vars);
        }

        // Hack make sure has python2
        try
        {
            await Ssh.sshExec(`/usr/bin/python --version 2> /dev/null || (sudo apt-get update && sudo apt-get -y install python-minimal)`, sshConfig, true);
        }
        catch(e)
        {

        }
        // Installing stuff.
        let resolveB = require('../../bakelets/resolve');
        await resolveB.resolveBakelet(bakeletsPath, remotesPath, doc, scriptPath, verbose)

    }

    static async retrieveSSHConfigByName(name) {
        let vmSSHConfigUser = await this.getSSHConfig(name);
        return vmSSHConfigUser;
    }
}

module.exports = VirtualBoxProvider;
