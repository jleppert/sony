import cv2
assert cv2.__version__[0] == '3', 'The fisheye module requires opencv version >= 3.0.0'

import numpy as np
import os
from time import sleep
import zerorpc
import json
import traceback

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
  def findChessboard(self, jpegBuffer):
    img = cv2.imdecode(np.fromstring(jpegBuffer, dtype='uint8'), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    #cv2.imshow('image',gray)
    #cv2.waitKey(0)
    #cv2.destroyAllWindows()

    # add initial corner guess from lower resolution version
    ret, corners = cv2.findChessboardCorners(gray, CHECKERBOARD, cv2.CALIB_CB_ADAPTIVE_THRESH+cv2.CALIB_CB_FAST_CHECK+cv2.CALIB_CB_NORMALIZE_IMAGE)
    print ret
    if ret == True:
        cv2.cornerSubPix(gray, corners, (3,3), (-1,-1), subpix_criteria)
        return corners
    return []

calib = FisheyeCalibration()

class NumpyEncoder(json.JSONEncoder):
  def default(self, obj):
    if isinstance(obj, np.ndarray):
      return obj.tolist()
    return json.JSONEncoder.default(self, obj)

while True:
  try:
    frameType, seq, frame = rpc.getFrame()
  except:
    print "Unable to get frame from remote"
    sleep(0.5)
    continue
  
  print "got frame with seq", seq
  if seq is not None:
    try:
      rpc.setChessboardResults(frameType, seq, json.dumps(calib.findChessboard(frame), cls=NumpyEncoder))
    except Exception as e:
      print "Unable to set chessboard results"
      print(traceback.format_exc())
      sleep(0.5)
  else:
    print "no frames to process"
    sleep(0.5)

#s = zerorpc.Server(FisheyeCalibration())
#s.bind("tcp://0.0.0.0:4242")
#print "started server on port 4242..."
#s.run()
