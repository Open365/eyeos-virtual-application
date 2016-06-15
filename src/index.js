/*
    Copyright (c) 2016 eyeOS

    This file is part of Open365.

    Open365 is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

var shell = require('child_process');
var uuid = require('node-uuid');
var settings = require('../settings.js');
var amqp = require('eyeos-amqp');
var url = require('url');
var fs = require('fs');

var Application = function(busIP, spicePassword) {
    this.busIP = busIP;
    this.spicePassword = spicePassword || uuid.v4();
    var self = this;
    this.setDockerBin(function(dockerBin) {
        self.dockerBin = dockerBin;
    });
};

Application.prototype.setDockerBin = function(callback) {

    var dockerBin = 'docker';
    fs.stat('/usr/local/bin/'+dockerBin+'-'+settings.dockerVersion, function(err, stats){
        if (!err) {
            dockerBin += '-' + settings.dockerVersion;
        }
        callback(dockerBin);
    });
};

Application.prototype.launch = function(appInfo, callback) {

    // Validate appInfo: { name: 'name', user: 'user', card: 'card', signature: 'signature', email_domain: 'email_domain'}
    // Optional properties: pretty_name. It defaults to user if not found.
    if (typeof appInfo !== 'object'
        || !appInfo.hasOwnProperty('name')
        || !appInfo.hasOwnProperty('user')
        || !appInfo.hasOwnProperty('card')
        || !appInfo.hasOwnProperty('signature')
        || !appInfo.hasOwnProperty('email_domain'))
    {

        console.warn("> Warning: On Application.launch, invalid 'appInfo' received.");
    }

    var self = this;
    this.prepareSubscription(appInfo, function(err, busSubscription) {
        if (err) {
            return callback(err);
        }

        // Prepare the 'docker run' command
        var command = self.prepareCommand(appInfo, busSubscription);
        console.log("> Command to execute: ", "'" + command.join("' '") + "'");
        // Run 'command'
        shell.execFile(command[0], command.slice(1), {env: self.prepareEnvironment(appInfo)}, function(error, stdout, stderr) {

            if(error) {
                // Try again?
                console.log("> Error: On Application.launch, executing docker run: ", stdout, stderr);
                return;
            }

            // Get ports used by this container
            var containerID = stdout.toString('utf-8').split("\n")[0];
            console.log("> Container id", containerID);
            command = '';
            if (appInfo.localisation) {
                command = 'DOCKER_HOST=' + appInfo.dockerHost;
                command += ' DOCKER_TLS_VERIFY=' + appInfo.dockerTLSVerify;
                command += ' DOCKER_MACHINE_NAME=' + appInfo.dockerMachineName + ' ';
            }
            command += this.dockerBin + ' port ' + containerID;
            console.log("> Docker port command", command);

            // Get and return information about the launched container
            shell.exec(command, function(error, stdout, stderr) {
                // 5900/tcp -> 0.0.0.0:32768
                console.log("> After docker port", error, stdout, stderr);
                var parts = stdout.toString('utf-8').split(':');
                var port = parts[1];
                port = port.split("\n")[0];
                var spiceHost = parts[0].split('-> ')[1];
                if (spiceHost === "0.0.0.0") {
                    // In self case we have to differentiate if we are running dockers
                    // in a remote host or not.
                    if (appInfo.dockerHost && appInfo.dockerHost.indexOf('unix://') === -1) {
                        spiceHost = url.parse(appInfo.dockerHost).hostname;
                    } else {
                        spiceHost = self.busIP;
                    }
                }

                var infoToReturn = {
                    host: spiceHost,
                    port: port,
                    protocol: 'wss',
                    token: self.spicePassword,
                    busHost: self.busIP,
                    busPort: 61613,
                    busUser: appInfo.minicard,
                    busPass: appInfo.minisignature,
                    busSubscriptions: [busSubscription]
                };

                if (appInfo.wsHost) {
                    infoToReturn.wsHost = appInfo.wsHost;
                }

                if (appInfo.wsPort) {
                    infoToReturn.wsPort = appInfo.wsPort;
                }

                callback(null, infoToReturn);

            }.bind(self));
        }.bind(self));
    });
};

//Generate and declare exchange for busSuscription
Application.prototype.prepareSubscription = function(appInfo, callback) {
    var exchange = 'user_' + appInfo.user + '@' + appInfo.domain + '_app_' + uuid.v4();
    var busSubscription = '/exchange/' + exchange + '/' + exchange;
    var connection = new amqp.Connection({
        host: appInfo.amqpBusHost,
        port: appInfo.amqpBusPort,
        login: appInfo.amqpBusUser,
        password: appInfo.amqpBusPass
    });
    connection.connect(function(err) {
        if (err) {
            console.error('Connection error: ', err);
            return callback(err);
        }
        console.log('AMQP Connection established');
        connection.declareExchange(exchange, {type:'topic', autoDelete:true}, function(err) {
            connection.disconnect(function() {
                console.log('Connection to bus disconnected.');
            });
            if (err) {
                console.error('Error creating exchange: ', err);
                return callback(err);
            } else {
                console.log('Exchange created.');
                return callback(null, busSubscription);
            }
        });
    });
};

// Prepares the 'docker run' command that will launch the required application's container for the user
Application.prototype.prepareCommand = function(appInfo, busSubscription) {

    var app = appInfo.name;
    var user = appInfo.user;
    var domain = appInfo.domain;
    var card = appInfo.card;
    var signature = appInfo.signature;
    var pretty_name = appInfo.pretty_name || appInfo.user;
    var email_domain = appInfo.email_domain;
    var lang = appInfo.lang || settings.defaultLang;
    var mysqlHost = appInfo.mysqlHost;
    var mysqlUser = appInfo.mysqlUsername;
    var mysqlPassword = appInfo.mysqlPassword;

    // User files mounting parameter
    var rawUserPath = settings.usersFilesPath + domain + '/' + user;

    var mounts = [];
    mounts.push("-v", rawUserPath + "/print:/mnt/eyeos/print");
    mounts.push("-v", rawUserPath + "/config:/home/user/");
    if (!appInfo.use_bind_mount_for_libraries || appInfo.use_bind_mount_for_libraries === 'false') {
        mounts.push("-v", rawUserPath + "/files:/home/user/files/");
    }

    // Prepare required envirnoment variables to pass to 'docker run'
    var dockerApp = ['node', '/root/start.js'].concat(app);
    var spiceRes = (appInfo.width || 1024) + "x" + (appInfo.height || 768);

    var envVars = [];
    envVars.push("-e", "LANG=" + lang);
    envVars.push("-e", "MYSQL_HOST=" + mysqlHost);
    envVars.push("-e", "MYSQL_USERNAME=" + mysqlUser);
    envVars.push("-e", "MYSQL_PASSWORD=" + mysqlPassword);
    envVars.push("-e", "MYSQL_DATABASE=" + appInfo.mysqlDbName);
    envVars.push("-e", "AMQP_BUS_HOST=" + (appInfo.amqpBusHost || this.busIP));
    envVars.push("-e", "BUS_ADDRESS_HOST=" + this.busIP);
    envVars.push("-e", "EYEOS_UNIX_USER=" + settings.eyeosUnixUser);
    envVars.push("-e", "SPICE_PASSWD=" + this.spicePassword);
    envVars.push("-e", "BUS_SUBSCRIPTION=" + busSubscription);
    envVars.push("-e", "COMMAND_TO_EXECUTE=" + JSON.stringify(dockerApp));
    envVars.push("-e", "AMQP_QUEUE=" + busSubscription);
    envVars.push("-e", "EYEOS_USER=" + user);
    envVars.push("-e", "EYEOS_DOMAIN=" + domain);
    envVars.push("-e", "EYEOS_TOKEN=" + appInfo.token);
    envVars.push("-e", "EYEOS_CARD=" + card);
    envVars.push("-e", "EYEOS_SIGNATURE=" + signature);
    envVars.push("-e", "EYEOS_MINI_CARD=" + appInfo.minicard);
    envVars.push("-e", "EYEOS_MINI_SIGNATURE=" + appInfo.minisignature);
    envVars.push("-e", "EYEOS_PRETTY_NAME=" + pretty_name);
    envVars.push("-e", "EMAIL_DOMAIN=" + email_domain);
    envVars.push("-e", "EYEOS_IMAP_HOST=" + appInfo.imap_host);
    envVars.push("-e", "EYEOS_SMTP_HOST=" + appInfo.smtp_host);
    envVars.push("-e", "USE_BIND_MOUNT_FOR_LIBRARIES=" + appInfo.use_bind_mount_for_libraries);
    envVars.push("-e", "ENABLE_LIBREOFFICE_AUTOSAVE=" + appInfo.enable_libreoffice_autosave);
    envVars.push("-e", "WEBDAV_HOST=" + (appInfo.webDAVHost || this.busIP));
    envVars.push("-e", "SPICE_RES=" + spiceRes);
    envVars.push("-e", "EYEOS_BUS_MASTER_USER=" + appInfo.minicard);
    envVars.push("-e", "EYEOS_BUS_MASTER_PASSWD=" + appInfo.minisignature);

    // Select the Docker image for this application
    var dockerImage = this.selectImage(app);

    // Create the command with which application's docker will be launched
    var dockerContainerName = user + "_" + app[0] + "_" + uuid.v4();

    var command = [
        this.dockerBin, 'run',
        '--name', dockerContainerName,
        '--cap-add=SYS_ADMIN', // mount fuse for webdav
        '--device=/dev/fuse',
        '-m="' + settings.resources.max_memory + '"',
        '--memory-swap="' + settings.resources.max_memory + '"',
        '--label=com.eyeos.container-type=user-application',
        '-d',
        '-P'
    ];
    command = command.concat(envVars);
    command = command.concat(mounts);
    command = command.concat(settings.dockerExtraArgs);
    command.push(dockerImage, 'exec.sh');

    return command;
};

Application.prototype.prepareEnvironment = function (appInfo) {
    var env = process.env;
    if (appInfo.localisation) {
        env['DOCKER_HOST'] = appInfo.dockerHost;
        env['DOCKER_TLS_VERIFY'] = appInfo.dockerTLSVerify;
        env['DOCKER_MACHINE_NAME'] = appInfo.dockerMachineName + ' ';
    }
    return env;
};

// Selects the appropiate Docker image depending on the application to be executed
Application.prototype.selectImage = function(app) {

    // Separate COMMAND from PARAMETERS, example ["writter", "file.odt"]
    var command = app[0];

    var dockerImage;

    console.log("> App requested:");
    console.log("> * application / command: '"+ command +"'");

    // Choose the corresponding docker image (writer,
    switch (command) {

        // Office applications
        case 'writer':
        case 'presentation':
        case 'calc':
            dockerImage = settings.images.open365_office;
            break;

        // Mail
        case 'mail':
            dockerImage = settings.images.open365_mail;
            break;

        // Gimp
        case 'gimp':
            dockerImage = settings.images.open365_gimp;
            break;
        
        default:
            // TODO: Throw an error instead of accepting any application
            // Appservice doesn't support raising an exception inside eyeos-virtual-application
            // without requeuing the messages and I don't want to return 200 OK if we had an error... :(
            console.warn("> Warning: launching default Docker image for required application '"+ command +"'");
            dockerImage = settings.images.open365_office;
    }

    console.log("> * docker image: '"+ dockerImage +"'");

    return dockerImage;
};

module.exports = {Application : Application};
