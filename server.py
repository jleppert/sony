import cv2
assert cv2.__version__[0] == '3', 'The fisheye module requires opencv version >= 3.0.0'

import numpy as np
import os
from time import sleep
import zerorpc
import json
import traceback
from pprint import pprint
import sys

rpc = zerorpc.Client()
rpc.connect("tcp://127.0.0.1:4242")

CHECKERBOARD = (6,8)
subpix_criteria = (cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER, 30, 0.1)
calibration_flags = cv2.fisheye.CALIB_RECOMPUTE_EXTRINSIC+cv2.fisheye.CALIB_CHECK_COND+cv2.fisheye.CALIB_FIX_SKEW

objp = np.zeros((1, CHECKERBOARD[0]*CHECKERBOARD[1], 3), np.float32)
objp[0,:,:2] = np.mgrid[0:CHECKERBOARD[0], 0:CHECKERBOARD[1]].T.reshape(-1, 2)

_img_shape = None
objpoints = [] # 3d point in real world space
imgpoints = [] # 2d points in image plane.

class FisheyeCalibration(object):
  FRAME_TYPE_PREVIEW  = 0
  FRAME_TYPE_FULLSIZE = 1
  FULLSIZE = [6000.0, 4000.0]
  PREVIEW = [1024.0, 680.0]
  scale = [PREVIEW[0] / FULLSIZE[0], PREVIEW[1] / FULLSIZE[1]]
  
  def initUndistortMap(self, K, D, size):
    mapX, mapY = cv2.fisheye.initUndistortRectifyMap(K, D, np.eye(3), K, size, cv2.CV_16SC2);
  
    return {
      x: mapX,
      y: mapY
    }

  def unDistort(self, image, mapX, mapY):
    return cv2.imdecode(np.fromstring(jpegBuffer, dtype='uint8'), cv2.IMREAD_COLOR)
    
  def calibrate(self, size, corners = []):
    K = np.zeros((3, 3))
    D = np.zeros((4, 1))
    rvecs = [np.zeros((1, 1, 3), dtype=np.float64) for i in range(len(corners))]
    tvecs = [np.zeros((1, 1, 3), dtype=np.float64) for i in range(len(corners))]
    
    objPoints = [objp for i in range(len(corners))]
    
    cv2.fisheye.calibrate(
      objPoints,
      corners,
      size,
      K, D,
      rvecs,
      tvecs,
      calibration_flags,
      (cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-6)
    )

    return {
      "K": K,
      "D": D,
      "rvcecs": rvecs,
      "tvecs": tvecs,
    }
    
  def findChessboard(self, frameType, jpegBuffer):
    img = cv2.imdecode(np.fromstring(jpegBuffer, dtype='uint8'), cv2.IMREAD_COLOR)
    if frameType == self.FRAME_TYPE_FULLSIZE:
      resized = cv2.resize(img, None, fx = self.scale[0], fy = self.scale[1], interpolation = cv2.INTER_LANCZOS4)
      grayResized = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
      ret, smallCorners = cv2.findChessboardCorners(grayResized, CHECKERBOARD, cv2.CALIB_CB_ADAPTIVE_THRESH+cv2.CALIB_CB_FAST_CHECK+cv2.CALIB_CB_NORMALIZE_IMAGE)
      if ret == True:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        scaledCorners = np.multiply(smallCorners, np.array([1 / self.scale[0], 1 / self.scale[1]]), dtype=np.float32)
        cv2.cornerSubPix(gray, scaledCorners, (5,5), (-1,-1), subpix_criteria)
        return [smallCorners, scaledCorners]
      return []
    else:
      gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
      ret, corners = cv2.findChessboardCorners(gray, CHECKERBOARD, cv2.CALIB_CB_ADAPTIVE_THRESH+cv2.CALIB_CB_FAST_CHECK+cv2.CALIB_CB_NORMALIZE_IMAGE)
      if ret == True:
        cv2.cornerSubPix(gray, corners, (5,5), (-1,-1), subpix_criteria)
        return corners
      return []

calib = FisheyeCalibration()

class NumpyEncoder(json.JSONEncoder):
  def default(self, obj):
    if isinstance(obj, np.ndarray):
      return obj.tolist()
    return json.JSONEncoder.default(self, obj)

def processFrames():
  print "Started processing frames..."

  while True:
    try:
      frameType, timestamp, seq, frameBuffer = rpc.getFrameRequest()
    except Exception as e:
      print "Unable to get frame from remote"
      print(traceback.format_exc())
      sleep(0.5)
      continue
    
    print "got frame with timestamp and seq", timestamp, seq
    if seq is not None:
      try:
        rpc.setChessboardResults(frameType, timestamp, seq, json.dumps(calib.findChessboard(frameType, frameBuffer), cls=NumpyEncoder))
      except Exception as e:
        print "Unable to set chessboard results"
        print(traceback.format_exc())
        sleep(0.5)
    else:
      print "no frames to process"
      sleep(0.5)

def processCalibrations():
  print "Started processing calibrations..."

  while True:
    try:
       ident, size, corners = rpc.getCalibrationRequest()
    except Exception as e:
      print "Unable to get calibration request from remote"
      print(traceback.format_exc())
      sleep(0.5)
      continue

    print "got calibration request with id", ident
    if ident is not None:
      try:
        corners = np.array(corners, dtype=np.float32)
        size = (size[0], size[1])
        print corners

        rpc.setCalibrationResults(ident, json.dumps(calib.calibrate(size, corners), cls=NumpyEncoder))
      except Exception as e:
        print "unable to set calibration results"
        print(traceback.format_exc())
        sleep(0.5)
    else:
      print "no calibrations to process"
      sleep(0.5)

def processCalibrationMaps():
  print "Started processing calibration maps..."

  while True:
    try:
      ident, K, D, size = rpc.getCalibrationMapRequest()
    except Exception as e:
      print "Unable to get calibration map request from remote"
      print(traceback.format_exc())
      sleep(0.5)
      continue

    print "got calibration map request with id", ident
    if ident is not None:
      try:
        K = np.array(K)
        D = np.array(D)
        size = (size[0], size[1])

        rpc.setCalibrationMapResult(ident, json.dumps(calib.initUndistortMap(K, D, size), cls=NumpyEncoder))
      except Exception as e:
        print "unable to set calibration results"
        print(traceback.format_exc())
        sleep(0.5)
    else:
      print "no calibrations to process"
      sleep(0.5)




task = sys.argv[1]
if(task == "frames"): processFrames()
if(task == "calibrations"): processCalibrations()
if(task == "maps"): processCalibrationMaps()
#s = zerorpc.Server(FisheyeCalibration())
#s.bind("tcp://0.0.0.0:4242")
#print "started server on port 4242..."
#s.run()
