const spawn = require('child_process').spawn;
const config = require('config');
const fs = require('fs');
const axios = require('axios');

let timeout_count=0;

console.log(`process.argv[2] is ${process.argv[2]}`);

const {join_api_key, feeds} = config;

const customLog = (()=>{
	let customLog;
	if(/nolog/.test(process.argv[2])){
		customLog = ()=>{};
	}else{
		customLog = function (...a){
			console.log(...a);
		};
	}
	return customLog;
})();

const customInfo = (()=>{
	let customInfo;
	if(/noinfo/.test(process.argv[2])){
		customInfo = ()=>{};
	}else{
		customInfo = function (...a){
			console.info(...a);
		};
	}
	return customInfo;
})();

function setupRecording( {input, out_dir, out_file, segment_time, restartCallbackFn} ){

	segment_time = segment_time || `00:05:00`;

	
	const restart_delay = 5000;
	const disconnect_start_delay = 10000;

	let last_notify=-1;
	function startRecording(){

		let ffmpeg_process = null; 
		let restart_timeout = null;
		let killed = false;
		let writableStream = fs.createWriteStream(`./${out_file}.log`);

		ffmpeg_process = spawn('ffmpeg',[
			// `-loglevel`, `verbose`,
			`-hwaccel_flags`, `allow_profile_mismatch`,
			`-hwaccel`, `vaapi`,
			`-hwaccel_device`, `/dev/dri/renderD128`,
			`-hwaccel_output_format`, `vaapi`,
			`-i`, input,
			`-c`, `copy`,
			`-reset_timestamps`, `1`,
			`-map`, `0`,
			`-segment_time`, segment_time,
			`-f`, `segment`,
			`-strftime`, `1`,
			`${out_dir}/${out_file}`
		]);
	
		// all ffmpeg logs go to stderror to allow for stdout to be piped to another process
		ffmpeg_process.stderr.on('data', function (data) {
			const s = data.toString();

			customInfo(s);

			// TODO check if frame log, maybe take action on other events too 
			if( /frame/.test(s) ){
				kickTheCan(true);
			}
			writableStream.write(data);
		});
	
		ffmpeg_process.on('exit', function (code) {
			if( code !== null && code !== undefined ){
				customLog(`${out_file} - child process exited with code ` + code.toString());
			}else{
				customLog(`${out_file} - child process exited. Code is either undefined or null`);
			}
			killed=true;
		});

		let last_kick=false;
		function kickTheCan(kick_is_from_subprocess=true){

			customInfo(`kickTheCan ${out_file}` );

			if( restart_timeout !== null ){
				clearInterval(restart_timeout);
			}

			// if was the initial kick last time, but have restablished a connection, notify
			if( last_kick===false && kick_is_from_subprocess===true ){
				
				let this_notify_timestamp=new Date().getTime();
				// don't notify more than once a minute
				console.log(`I think we're back after a restart. ${out_file}`);
				console.log({last_notify,this_notify_timestamp});
				if((last_notify+1000*60)<this_notify_timestamp){
					notify(`First good loop for ${out_file}`); // findmedrew
					last_notify=this_notify_timestamp;
				}
			}
			
			last_kick=kick_is_from_subprocess;

			restart_timeout = setTimeout(async()=>{
				customLog(`---------- NO UPDATE; RESTARTING RECORDING ${out_file} ----------`);
				customLog(`${timeout_count}`);

				let kill_try_count = 0;

				while( killed===false && kill_try_count < 10 ){
					killed = ffmpeg_process.kill('SIGKILL');
					customLog(`Tried to stop process.... ${killed ? "worked" : "didn't work"}`);

					if( restart_timeout.killed ){
						killed = true;
					}

					kill_try_count++;
					await timeoutPromise(500);
				}

				if(killed){
					startRecording();
					restartCallbackFn();
					writableStream.close();
					try{
						fs.copyFileSync(`./${out_file}.log`, `./${out_file}.restart.log`);
					}catch(e){
						console.log(`issue copying file ${out_file}`);
					}
				}else{
					notify(`Could not kill camera record process for ${out_file}`);
					throw new Error('Could not close old process... not sure how to continue');
				}

			},restart_delay);
		}

		// initial interval... will be called in a loop later 
		kickTheCan(false);
	}

	startRecording();


};

(()=>{

	Object.keys(feeds).forEach((i)=>{

		if(!fs.existsSync(feeds[i].out_dir)){
			console.error(`out_dir does not exist - ${feeds[i].out_dir}`);
		}

		let restart_count=0;
		let last_restart_notified=null;

		function restartCallbackFn(){
			
			const max_restart_count = 2;
			
			console.log({
				"msg":"restartCallbackFn",
				out_file:feeds[i].out_file,
				restart_count,
				max_restart_count,
			});
			
			if( restart_count >= max_restart_count ){
				if(last_restart_notified === null){
					notify(`camera restarting ${restart_count} times - ${feeds[i].out_file}`);
					last_restart_notified=new Date();
					setTimeout(()=>{
						last_restart_notified=null;
					},1000*60*60); // reset after 1 hr
				}
				restart_count=0;
			}else{
				restart_count++
			}
		}	

		setupRecording( {
			input: feeds[i].input,
			out_dir: feeds[i].out_dir,
			out_file: feeds[i].out_file,
			segment_time: feeds[i].segment_time,
			restartCallbackFn,
		});	
	});

})();

function notify(text){
	axios.post(`https://joinjoaomgcd.appspot.com/_ah/api/messaging/v1/sendPush?apikey=${join_api_key}&deviceId=group.android`,{
		title:"title",
		text
	}).catch((e)=>{
		console.error(`error sending notification`);
		console.error(`\n${text}\n`);
		console.error(e);
	});
}

function timeoutPromise(ms){
	return new Promise((resolve, reject)=>{
	  setTimeout(resolve,ms);
	}); 
  }
  
