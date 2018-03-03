const yaml = require('js-yaml');
const fs   = require('fs');
const path = require('path');
const Promise = require('bluebird');
const vagrant = Promise.promisifyAll(require('node-vagrant'));

const start = require('./start');

const { commands, modules } = require('../../baker');
const spinnerDot = modules['spinnerDot'];
const spinner = modules['spinner'];
const boxes = modules['boxes'];
const baker = modules['baker'];

module.exports.resolveBakelet = async function(bakeletsPath, remotesPath, doc, bakerScriptPath, verbose)
{

    //let doc;
    try {
        //doc = yaml.safeLoad(
        //    fs.readFileSync(config, 'utf8')
        //);

        if( verbose ) console.log( doc );

        let extra_vars = [];
        if( doc.vars )
        {
            extra_vars = doc.vars;
        }

        if( doc.lang )
        {
            for (var i = 0; i < doc.lang.length; i++)
            {
                await resolve(doc.name, bakerScriptPath, remotesPath, path.join(bakeletsPath,"lang"), doc.lang[i], extra_vars, verbose);
            }
        }

        if( doc.config )
        {
            for (var i = 0; i < doc.config.length; i++)
            {
                await resolve(doc.name, bakerScriptPath, remotesPath, path.join(bakeletsPath,"config"), doc.config[i], extra_vars, verbose);
            }
        }

        if( doc.services )
        {
            for (var i = 0; i < doc.services.length; i++)
            {
                await resolve(doc.name, bakerScriptPath, remotesPath, path.join(bakeletsPath,"services"), doc.services[i], extra_vars, verbose);
            }
        }

        if( doc.tools )
        {
            for (var i = 0; i < doc.tools.length; i++)
            {
                await resolve(doc.name, bakerScriptPath, remotesPath, path.join(bakeletsPath,"tools"), doc.tools[i], extra_vars, verbose);
            }
        }

        if( doc.packages )
        {
            for (var i = 0; i < doc.packages.length; i++)
            {
                await resolve(doc.name, bakerScriptPath, remotesPath, path.join(bakeletsPath,"packages"), doc.packages[i], extra_vars, verbose);
            }
        }

        if( doc.env )
        {
            doc.env = [{env: doc.env}]; // fixing the format // TODO: it works ok, but probably too hacky
            await resolve(doc.name, bakerScriptPath, remotesPath, path.join(bakeletsPath,"env"), doc.env[0], extra_vars, verbose);
        }

        if( doc.start )
        {
            // let dir = path.join(boxes, doc.name);
            // let vm = vagrant.create({ cwd: dir });

            const boxes = path.join(require('os').homedir(), '.baker');
            const ansible = path.join(boxes, 'ansible-srv');
            let machine = vagrant.create({ cwd: ansible });
            let ansibleSSHConfig = await getSSHConfig(machine);

            console.log("Starting command", doc.start);
            start(doc.start, doc.name, ansibleSSHConfig, verbose);
        }



    } catch (error) {
        throw `Error: ${error}`
    }
}

function isObject(obj)
{
    return obj === Object(obj) && Object.prototype.toString.call(obj) !== '[object Array]'
}

async function getSSHConfig(machine) {
    try {
        let sshConfig = await machine.sshConfigAsync();
        if(sshConfig && sshConfig.length > 0){
            return sshConfig[0];
        } else{
            throw '';
        }
    } catch (err) {
        throw `Couldn't get private ssh key of machine ${err}`;
    }
}

async function resolve(vmName, bakerScriptPath, remotesPath, dir, bakelet, extra_vars, verbose)
{
    let mod = "";
    let version = "";
    if( isObject(bakelet) )
    {
        // complex objects, like templates.
        mod = dir + "/" + Object.keys(bakelet)[0];
    }
    else
    {
        // This will correctly match neo4j3.3, java8, python etc.
        let regex = /([a-zA-Z-0-9]*)([0-9]+\.?[0-9]*$)|([a-zA-Z-0-9]*)/;
        mod =  dir + "/" + bakelet;
        let match = bakelet.match(regex);
        if( match.length == 4)
        {
            if( match[1] === undefined && match[2] === undefined )
            {
                // We did not capture anything in the first part of regex. So, we have no version, just the mod.
                // This is captured in third group.
                mod =  dir + "/" + match[3];
            }
            else
            {
                mod =  dir + "/" + match[1];
                version = match[2];
            }
        }
        if( verbose ) console.log("Found", mod, version, extra_vars);
    }

    let classFoo = require(mod)

    const boxes = path.join(require('os').homedir(), '.baker');
    const ansible = path.join(boxes, 'ansible-srv');
    let machine = vagrant.create({ cwd: ansible });
    let ansibleSSHConfig = await getSSHConfig(machine);

    let j = new classFoo(vmName, ansibleSSHConfig, version);
    j.setRemotesPath(remotesPath);
    j.setBakePath(bakerScriptPath);
    j.setVerbose(verbose);

    await spinner.spinPromise(j.load(bakelet,extra_vars), `Preparing ${mod} scripts`, spinnerDot);
    await spinner.spinPromise(j.install(), `Installing ${mod}`, spinnerDot);
}