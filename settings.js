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

var settings = {
    eyeosUnixUser: process.env.EYEOS_UNIX_USER || 'user',
    usersFilesPath: process.env.USERS_PATH || '/mnt/rawFS/users/',
    defaultLang: process.env.OPEN365_APP_DEFAULT_LANG || 'en_US.UTF-8',
    resources: {
        max_memory: "600M"
    },
    images: {
        open365_office: process.env.EYEOS_VIRTUAL_APPLICATION_OPEN365_OFFICE_IMAGE || 'eyeos/open365-office:latest',
        open365_mail: process.env.EYEOS_VIRTUAL_APPLICATION_OPEN365_MAIL_IMAGE || 'eyeos/open365-mail:latest'
    },
    dockerExtraArgs: process.env.OPEN365_DOCKER_EXTRA_ARGS || '[]'
};
try {
    settings.dockerExtraArgs = JSON.parse(settings.dockerExtraArgs);
    if(! Array.isArray(settings.dockerExtraArgs)) {
        throw new Error("OPEN365_DOCKER_EXTRA_ARGS is valid JSON, but not an array.");
    }
} catch(e) {
    console.log("Error parsing OPEN365_DOCKER_EXTRA_ARGS: Not a valid JSON array");
    settings.dockerExtraArgs = [];
}
module.exports = settings;
