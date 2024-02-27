const spawn = require('child_process').spawn;
const config = require('config');
const fs = require('fs');
const fs_promise = require('fs/promises');
const axios = require('axios');

let timeout_count=0;

console.log(`process.argv[2] is ${process.argv[2]}`);

const {join_api_key, feeds, report_when_camera_down_ms} = config;

const customLog = (()=>{
	let customLog;
	const extra_log_file = `./extra_log_file.log`;
	fs_promise.unlink(extra_log_file).catch(()=>{});
	if(/nolog/.test(process.argv[2])){
		customLog = (...a)=>{
			let to_write;
			if(Array.isArray(a)){
				to_write = a.join(", ");
			}else{
				to_write = a;
			}
			fs_promise.writeFile(extra_log_file, a).catch(()=>{}); 
		};
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

function setupRecording( {name, input, out_dir, out_file, segment_time, other_args, i} ){

	const last_good_frame = new Date()
	let known_down = false;

	segment_time = segment_time || `00:05:00`;
	
	const restart_delay = 10000;
	const disconnect_start_delay = 10000;

	let last_notify=-1;
	function startRecording({is_first_call, last_good_frame}){

		if(is_first_call===undefined){
			throw new Error('is_first_call is undefined');
		}
		if(last_good_frame===undefined){
			throw new Error('last_good_frame is undefined');
		}

		if( last_good_frame !==undefined ){
			const now = new Date();
			const time_diff = now.getTime() - last_good_frame.getTime();
			if( time_diff > report_when_camera_down_ms && known_down===false ){
				notify({
					title:`${name} - camera down`,
					text:`${niceDate(new Date())}`,
				});
				known_down = true;
			}
			console.log({time_diff,time_diff,now,last_good_frame,})
		}

		let ffmpeg_process = null; 
		let restart_timeout = null;
		let killed = false;
		let writableStream = fs.createWriteStream(`./${out_file}.log`);

		const args = [
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
		];

		if( other_args!==undefined && other_args!==null ){
			args.push(...other_args);
		}

		args.push(`${out_dir}/${out_file}`);

		ffmpeg_process = spawn('ffmpeg',args);
	
		// all ffmpeg logs go to stderror to allow for stdout to be piped to another process
		ffmpeg_process.stderr.on('data', function (data) {
			const s = data.toString();

			customInfo(s);

			// check if frame log // TODO maybe take action on other events too 
			if( /frame/.test(s) ){
				kickTheCan({is_first_call:false});
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

		// let last_kick=false;
		function kickTheCan({is_first_call, init_recording}){
			
			if(is_first_call===undefined){
				throw new Error('is_first_call is undefined');
			}

			customInfo(`kickThe Can ${out_file}` );

			if( is_first_call===false && init_recording!==true ){
				if( known_down === true ){
					const now = new Date();
					const down_time = (now.getTime()) - last_good_frame.getTime();
					notify({
						title:`${name} - camera back up`,
						text:`${niceDate(now)} - down for ${smartTimeStr(down_time)}`,
					});
					known_down = false;
				}
				last_good_frame = new Date();
			}

			if( restart_timeout !== null ){
				clearInterval(restart_timeout);
			}

			// if was the initial kick last time, but have restablished a connection, notify
			if( is_first_call===true ){
				notify({
					title:`${name} - started`,
					text:`${niceDate(new Date())}`,
				});
			}else{

			}

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
					startRecording({is_first_call:false, last_good_frame});
					writableStream.close();
					try{
						fs.copyFileSync(`./${out_file}.log`, `./${out_file}.restart.log`);
					}catch(e){
						console.log(`issue copying file ${out_file}`);
					}
				}else{
					notify({
						title:`${name} - error`,
						text:`${niceDate(new Date())} - Could not kill camera record process`,
					});
					writableStream.close();
					throw new Error('Could not close old process... not sure how to continue');
				}

			},restart_delay);
		}

		// initial interval... will be called in a loop later 
		kickTheCan({is_first_call, init_recording:true});
	}

	startRecording({is_first_call:true, last_good_frame});
};

(()=>{

	Object.keys(feeds).forEach((i)=>{

		if(!fs.existsSync(feeds[i].out_dir)){
			console.error(`out_dir does not exist - ${feeds[i].out_dir}`);
		}

		setupRecording( {
			name: feeds[i].name || feeds[i].out_file, 
			input: feeds[i].input,
			out_dir: feeds[i].out_dir,
			out_file: feeds[i].out_file,
			segment_time: feeds[i].segment_time,
			other_args: feeds[i].other_args,
			i,
		});	
	});

})();

function notify(value){

	let text = value;
	let title = "title";

	if( value.text !==undefined ){
		text = value.text;
	}
	if( value.title !==undefined ){
		title = value.title;
	}

	axios.post(`https://joinjoaomgcd.appspot.com/_ah/api/messaging/v1/sendPush?apikey=${join_api_key}&deviceId=group.android`,{
		title,
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
  
function smartTimeStr(ms_count){

	const ONE_SEC = 1000;
	const ONE_MIN = ONE_SEC * 60;
	const ONE_HR = ONE_MIN * 60;

	if( ms_count < ONE_SEC ){
		return `${ms_count} ms`;
	}else if( ms_count < ONE_MIN ){
		return `${parseInt(ms_count/ONE_SEC*100)/100} sec`
	}else if( ms_count < ONE_HR ){
		return `${parseInt(ms_count/ONE_MIN*100)/100} min`
	}else{
		return `${parseInt(ms_count/ONE_HR*100)/100} hr`
	}

}

function niceDate(date_obj){
    const full_year = date_obj.getFullYear();
    const month = date_obj.getMonth();
    const date = date_obj.getDate();
    const hours = date_obj.getHours();
    const minutes = date_obj.getMinutes();
    const seconds = date_obj.getSeconds();

    return `${zeroPad(month)}/${zeroPad(date)} ${zeroPad(hours)}:${zeroPad(minutes)}:${zeroPad(seconds)}`;
}

function zeroPad(num){
	if(num<10){
		return "0"+num;
	}
	return num;
}
